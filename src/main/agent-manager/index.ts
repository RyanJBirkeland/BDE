import type { AgentManagerConfig, ActiveAgent, SteerResult, Logger } from './types'
import {
  EXECUTOR_ID,
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
  QUEUE_TIMEOUT_MS,
  INITIAL_DRAIN_DEFER_MS,
  NOTES_MAX_LENGTH,
} from './types'
import {
  makeConcurrencyState,
  availableSlots,
  applyBackpressure,
  tryRecover,
  type ConcurrencyState,
} from './concurrency'
import { checkAgent } from './watchdog'
import { setupWorktree, pruneStaleWorktrees } from './worktree'
import { recoverOrphans } from './orphan-recovery'
import { createDependencyIndex } from './dependency-index'
import { formatBlockedNote } from './dependency-helpers'
import { resolveDependents } from './resolve-dependents'
import { runAgent as _runAgent, type RunAgentDeps } from './run-agent'
import { setSprintQueriesLogger } from '../data/sprint-queries'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getRepoPaths } from '../paths'
import { refreshOAuthTokenFromKeychain, invalidateOAuthToken } from '../env-utils'

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to console
// ---------------------------------------------------------------------------

import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { homedir as home } from 'node:os'
import { BDE_AGENT_LOG_PATH } from '../paths'
const LOG_PATH = BDE_AGENT_LOG_PATH
function fileLog(level: string, m: string): void {
  try { appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [${level}] ${m}\n`) } catch {}
}

const defaultLogger: Logger = {
  info: (m) => { console.log(m); fileLog('INFO', m) },
  warn: (m) => { console.warn(m); fileLog('WARN', m) },
  error: (m) => { console.error(m); fileLog('ERROR', m) },
}

// ---------------------------------------------------------------------------
// Extracted pure functions (testable independently)
// ---------------------------------------------------------------------------

/**
 * Check whether the OAuth token file exists and contains a valid token.
 * Returns true if the drain loop should proceed, false if it should skip.
 */
export async function checkOAuthToken(logger: Logger): Promise<boolean> {
  try {
    const tokenPath = joinPath(home(), '.bde', 'oauth-token')
    const token = readFileSync(tokenPath, 'utf-8').trim()
    if (!token || token.length < 20) {
      const refreshed = await refreshOAuthTokenFromKeychain()
      if (refreshed) {
        logger.info('[agent-manager] OAuth token auto-refreshed from Keychain')
        return true
      } else {
        logger.warn('[agent-manager] OAuth token file missing/empty and keychain refresh failed — skipping drain cycle')
        return false
      }
    }

    // Proactively refresh if token file is older than 45 minutes
    // (Claude OAuth tokens expire after ~1 hour)
    try {
      const stat = statSync(tokenPath)
      const ageMs = Date.now() - stat.mtimeMs
      if (ageMs > 45 * 60 * 1000) {
        logger.info('[agent-manager] Token file older than 45min — proactively refreshing')
        const refreshed = await refreshOAuthTokenFromKeychain()
        if (refreshed) {
          invalidateOAuthToken()
          logger.info('[agent-manager] OAuth token proactively refreshed from Keychain')
        }
      }
    } catch { /* stat failed — continue with existing token */ }

    return true
  } catch {
    logger.warn('[agent-manager] Cannot read OAuth token file — skipping drain cycle')
    return false
  }
}

export type WatchdogVerdict = 'max-runtime' | 'idle' | 'rate-limit-loop'

/**
 * Handle a watchdog verdict by updating the task and optionally applying backpressure.
 * Returns the (possibly updated) concurrency state.
 */
export function handleWatchdogVerdict(
  verdict: WatchdogVerdict,
  taskId: string,
  concurrency: ConcurrencyState,
  now: string,
  updateTaskFn: (id: string, patch: Record<string, unknown>) => Promise<unknown>,
  onTerminal: (id: string, status: string) => Promise<void>,
  logger: Logger,
): ConcurrencyState {
  if (verdict === 'max-runtime') {
    updateTaskFn(taskId, { status: 'error', completed_at: now, notes: 'Max runtime exceeded', needs_review: true })
      .then(() => onTerminal(taskId, 'error'))
      .catch((err) => logger.warn(`[agent-manager] Failed to update task ${taskId} after max-runtime kill: ${err}`))
  } else if (verdict === 'idle') {
    updateTaskFn(taskId, { status: 'error', completed_at: now, notes: 'Idle timeout', needs_review: true })
      .then(() => onTerminal(taskId, 'error'))
      .catch((err) => logger.warn(`[agent-manager] Failed to update task ${taskId} after idle kill: ${err}`))
  } else if (verdict === 'rate-limit-loop') {
    concurrency = applyBackpressure(concurrency, Date.now())
    updateTaskFn(taskId, { status: 'queued', claimed_by: null, notes: 'Rate-limit loop — re-queued' })
      .catch((err) => logger.warn(`[agent-manager] Failed to requeue rate-limited task ${taskId}: ${err}`))
  }
  return concurrency
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AgentManagerStatus {
  running: boolean
  shuttingDown: boolean
  concurrency: ConcurrencyState
  activeAgents: Array<{
    taskId: string
    agentRunId: string
    model: string
    startedAt: number
    lastOutputAt: number
    rateLimitCount: number
    costUsd: number
    tokensIn: number
    tokensOut: number
  }>
}

export interface AgentManager {
  start(): void
  stop(timeoutMs?: number): Promise<void>
  getStatus(): AgentManagerStatus
  steerAgent(taskId: string, message: string): Promise<SteerResult>
  killAgent(taskId: string): void
  onTaskTerminal(taskId: string, status: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentManager(
  config: AgentManagerConfig,
  repo: ISprintTaskRepository,
  logger: Logger = defaultLogger,
): AgentManager {
  // ---- Core state ----
  let concurrency: ConcurrencyState = makeConcurrencyState(config.maxConcurrent)
  const activeAgents = new Map<string, ActiveAgent>()
  let running = false
  let shuttingDown = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let watchdogTimer: ReturnType<typeof setInterval> | null = null
  let orphanTimer: ReturnType<typeof setInterval> | null = null
  let pruneTimer: ReturnType<typeof setInterval> | null = null
  let drainInFlight: Promise<void> | null = null
  let drainRunning = false
  const agentPromises = new Set<Promise<void>>()
  const depIndex = createDependencyIndex()

  // Wire sprint-queries to use the same structured file logger as the agent manager
  setSprintQueriesLogger(logger)

  // Wrap repo methods with timeout to prevent infinite hang (Electron main-process fetch can hang)
  async function fetchQueuedTasks(limit: number): Promise<Array<Record<string, unknown>>> {
    const result = await Promise.race([
      repo.getQueuedTasks(limit),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('getQueuedTasks timeout')), QUEUE_TIMEOUT_MS)),
    ])
    return result as unknown as Array<Record<string, unknown>>
  }

  async function claimTaskViaApi(taskId: string): Promise<boolean> {
    const result = await Promise.race([
      repo.claimTask(taskId, EXECUTOR_ID),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('claimTask timeout')), QUEUE_TIMEOUT_MS)),
    ])
    return result !== null
  }

  async function onTaskTerminal(taskId: string, status: string): Promise<void> {
    try {
      await resolveDependents(taskId, status, depIndex, repo.getTask, repo.updateTask, logger)
    } catch (err) {
      logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
    }
  }

  // ---- Helpers ----

  const runAgentDeps: RunAgentDeps = { activeAgents, defaultModel: config.defaultModel, logger, onTaskTerminal, repo }

  function isActive(taskId: string): boolean {
    return activeAgents.has(taskId)
  }

  function resolveRepoPath(repoSlug: string): string | null {
    const repoPaths = getRepoPaths()
    return repoPaths[repoSlug.toLowerCase()] ?? null
  }

  // ---- processQueuedTask ----

  async function processQueuedTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>,
  ): Promise<void> {
    // Map Queue API camelCase response to local task shape
    // Ensure retry_count and fast_fail_count default to 0, prompt and spec default to null
    const task = {
      id: raw.id as string,
      title: raw.title as string,
      prompt: (raw.prompt as string) ?? null,
      spec: (raw.spec as string) ?? null,
      repo: raw.repo as string,
      retry_count: Number(raw.retryCount) || 0,
      fast_fail_count: Number(raw.fastFailCount) || 0,
      playground_enabled: Boolean(raw.playgroundEnabled),
      max_runtime_ms: Number(raw.maxRuntimeMs) || null,
    }

    // Defense-in-depth: check dependencies before claiming.
    // Tasks created via direct API may be 'queued' with unsatisfied deps.
    const rawDeps = raw.dependsOn ?? raw.depends_on
    if (rawDeps) {
      try {
        const deps = typeof rawDeps === 'string' ? JSON.parse(rawDeps) : rawDeps
        if (Array.isArray(deps) && deps.length > 0) {
          const { satisfied, blockedBy } = depIndex.areDependenciesSatisfied(
            task.id,
            deps,
            (depId: string) => taskStatusMap.get(depId),
          )
          if (!satisfied) {
            logger.info(`[agent-manager] Task ${task.id} has unsatisfied deps [${blockedBy.join(', ')}] — auto-blocking`)
            await repo.updateTask(task.id, {
              status: 'blocked',
              notes: formatBlockedNote(blockedBy),
            }).catch(() => {})
            return
          }
        }
      } catch {
        // If dep parsing fails, proceed without blocking
      }
    }

    // Resolve repo path
    const repoPath = resolveRepoPath(task.repo)
    if (!repoPath) {
      logger.warn(`[agent-manager] No repo path for "${task.repo}" — skipping task ${task.id}`)
      return
    }

    // Claim task
    const claimed = await claimTaskViaApi(task.id)
    if (!claimed) {
      logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
      return
    }

    // Setup worktree
    let wt: { worktreePath: string; branch: string }
    try {
      wt = await setupWorktree({
        repoPath,
        worktreeBase: config.worktreeBase,
        taskId: task.id,
        title: task.title,
        logger,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`[agent-manager] setupWorktree failed for task ${task.id}: ${errMsg}`)
      await repo.updateTask(task.id, {
        status: 'error',
        completed_at: new Date().toISOString(),
        notes: `Worktree setup failed: ${errMsg}`.slice(0, NOTES_MAX_LENGTH),
        claimed_by: null,
      })
      await onTaskTerminal(task.id, 'error')
      return
    }

    // Fire-and-forget — errors logged inside runAgent
    const p = _runAgent(task, wt, repoPath, runAgentDeps).catch((err) => {
      logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
    }).finally(() => { agentPromises.delete(p) })
    agentPromises.add(p)
  }

  // ---- drainLoop ----

  async function drainLoop(): Promise<void> {
    if (drainRunning) {
      logger.info('[agent-manager] Drain loop already running — skipping')
      return
    }
    drainRunning = true
    try {
      logger.info(`[agent-manager] Drain loop starting (shuttingDown=${shuttingDown}, slots=${availableSlots(concurrency, activeAgents.size)})`)
      if (shuttingDown) return

      // Refresh dependency index each drain cycle to pick up tasks created
      // since startup or since the last drain. Rebuild is O(n) and cheap.
      let taskStatusMap = new Map<string, string>()
      try {
        const allTasks = await repo.getTasksWithDependencies()
        depIndex.rebuild(allTasks)
        taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]))
      } catch (err) {
        logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
      }

      const available = availableSlots(concurrency, activeAgents.size)
      if (available <= 0) return

      try {
        const tokenOk = await checkOAuthToken(logger)
        if (!tokenOk) return

        logger.info(`[agent-manager] Fetching queued tasks via Queue API (limit=${available})...`)
        const queued = await fetchQueuedTasks(available)
        logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
        for (const raw of queued) {
          if (shuttingDown) break
          // Re-check slots before each task — an earlier iteration may have filled a slot
          if (availableSlots(concurrency, activeAgents.size) <= 0) {
            logger.info('[agent-manager] No slots available — stopping drain iteration')
            break
          }
          try {
            await processQueuedTask(raw, taskStatusMap)
          } catch (err) {
            logger.error(`[agent-manager] Failed to process task ${(raw as Record<string, unknown>).id}: ${err}`)
          }
        }
      } catch (err) {
        logger.error(`[agent-manager] Drain loop error: ${err}`)
      }

      concurrency = tryRecover(concurrency, Date.now())
    } finally {
      drainRunning = false
    }
  }

  // ---- watchdogLoop ----

  function watchdogLoop(): void {
    for (const agent of activeAgents.values()) {
      const verdict = checkAgent(agent, Date.now(), config)
      if (verdict === 'ok') continue

      logger.warn(`[agent-manager] Watchdog killing task ${agent.taskId}: ${verdict}`)
      try { agent.handle.abort() } catch (err) {
        logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
      }

      // Delete agent — activeCount is derived from activeAgents.size
      activeAgents.delete(agent.taskId)

      // Update task based on verdict
      const now = new Date().toISOString()
      concurrency = handleWatchdogVerdict(verdict, agent.taskId, concurrency, now, repo.updateTask, onTaskTerminal, logger)
    }
  }

  // ---- orphanLoop ----

  async function orphanLoop(): Promise<void> {
    try {
      await recoverOrphans(isActive, repo, logger)
    } catch (err) {
      logger.error(`[agent-manager] Orphan recovery error: ${err}`)
    }
  }

  // ---- pruneLoop ----

  async function pruneLoop(): Promise<void> {
    try {
      await pruneStaleWorktrees(config.worktreeBase, isActive)
    } catch (err) {
      logger.error(`[agent-manager] Worktree prune error: ${err}`)
    }
  }

  // ---- Public methods ----

  function start(): void {
    if (running) return
    running = true
    shuttingDown = false
    concurrency = makeConcurrencyState(config.maxConcurrent)

    // Initial orphan recovery (fire-and-forget)
    recoverOrphans(isActive, repo, logger).catch((err) => {
      logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
    })

    // Build dependency index
    repo.getTasksWithDependencies().then((tasks) => {
      depIndex.rebuild(tasks)
      logger.info(`[agent-manager] Dependency index built with ${tasks.length} tasks`)
    }).catch((err) => {
      logger.error(`[agent-manager] Failed to build dependency index: ${err}`)
    })

    // Initial worktree prune (fire-and-forget)
    pruneStaleWorktrees(config.worktreeBase, isActive).catch((err) => {
      logger.error(`[agent-manager] Initial worktree prune error: ${err}`)
    })

    // Start periodic loops
    pollTimer = setInterval(() => {
      if (drainInFlight) return // skip if previous drain still running
      drainInFlight = drainLoop().catch((err) => logger.warn(`[agent-manager] Drain loop error: ${err}`)).finally(() => { drainInFlight = null })
    }, config.pollIntervalMs)
    watchdogTimer = setInterval(watchdogLoop, WATCHDOG_INTERVAL_MS)
    orphanTimer = setInterval(() => { orphanLoop().catch((err) => logger.warn(`[agent-manager] Orphan loop error: ${err}`)) }, ORPHAN_CHECK_INTERVAL_MS)
    pruneTimer = setInterval(() => { pruneLoop().catch((err) => logger.warn(`[agent-manager] Prune loop error: ${err}`)) }, WORKTREE_PRUNE_INTERVAL_MS)

    // Defer initial drain to let the event loop process (Supabase fetch needs this)
    setTimeout(() => {
      drainInFlight = drainLoop().catch((err) => logger.warn(`[agent-manager] Initial drain error: ${err}`)).finally(() => { drainInFlight = null })
    }, INITIAL_DRAIN_DEFER_MS)

    logger.info('[agent-manager] Started')
  }

  async function stop(timeoutMs = 10_000): Promise<void> {
    shuttingDown = true

    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null }
    if (orphanTimer) { clearInterval(orphanTimer); orphanTimer = null }
    if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null }

    // Wait for any in-flight drain to complete before aborting agents
    if (drainInFlight) {
      await drainInFlight.catch(() => {})
      drainInFlight = null
    }

    // Abort all active agents
    for (const agent of activeAgents.values()) {
      try { agent.handle.abort() } catch (err) {
        logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId} during shutdown: ${err}`)
      }
    }

    // Wait for all agent promises to settle (with timeout)
    if (agentPromises.size > 0) {
      const allSettled = Promise.allSettled([...agentPromises])
      const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs))
      await Promise.race([allSettled, timeout])
    }

    running = false
    logger.info('[agent-manager] Stopped')
  }

  function getStatus(): AgentManagerStatus {
    return {
      running,
      shuttingDown,
      concurrency: { ...concurrency, activeCount: activeAgents.size },
      activeAgents: [...activeAgents.values()].map((a) => ({
        taskId: a.taskId,
        agentRunId: a.agentRunId,
        model: a.model,
        startedAt: a.startedAt,
        lastOutputAt: a.lastOutputAt,
        rateLimitCount: a.rateLimitCount,
        costUsd: a.costUsd,
        tokensIn: a.tokensIn,
        tokensOut: a.tokensOut,
      })),
    }
  }

  async function steerAgent(taskId: string, message: string): Promise<SteerResult> {
    const agent = activeAgents.get(taskId)
    if (!agent) return { delivered: false, error: 'Agent not found' }
    return agent.handle.steer(message)
  }

  function killAgent(taskId: string): void {
    const agent = activeAgents.get(taskId)
    if (!agent) throw new Error(`No active agent for task ${taskId}`)
    agent.handle.abort()
  }

  return { start, stop, getStatus, steerAgent, killAgent, onTaskTerminal }
}
