import type { AgentManagerConfig, ActiveAgent, AgentHandle, Logger } from './types'
import {
  EXECUTOR_ID,
  MAX_RETRIES,
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
  SPAWN_TIMEOUT_MS,
  QUEUE_TIMEOUT_MS,
  INITIAL_DRAIN_DEFER_MS,
} from './types'
import {
  makeConcurrencyState,
  availableSlots,
  applyBackpressure,
  tryRecover,
  type ConcurrencyState,
} from './concurrency'
import { checkAgent } from './watchdog'
import { classifyExit } from './fast-fail'
import { setupWorktree, cleanupWorktree, pruneStaleWorktrees } from './worktree'
import { spawnAgent } from './sdk-adapter'
import { resolveSuccess, resolveFailure } from './completion'
import { recoverOrphans } from './orphan-recovery'
import { createDependencyIndex } from './dependency-index'
import { resolveDependents } from './resolve-dependents'
import { updateTask, getTask, getTasksWithDependencies } from '../data/sprint-queries'
import { getRepoPaths, getGhRepo } from '../paths'
import { randomUUID } from 'node:crypto'

// Use sprint-queries directly but with a wrapper that catches hangs.
// Electron's main process fetch/Supabase can hang, so we import the functions
// that the Queue API uses (which work because they're called from HTTP handlers).
import { getQueuedTasks as _getQueuedTasks, claimTask as _claimTask } from '../data/sprint-queries'

async function fetchQueuedTasks(limit: number): Promise<Array<Record<string, unknown>>> {
  // Wrap with timeout to prevent infinite hang
  const result = await Promise.race([
    _getQueuedTasks(limit),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('getQueuedTasks timeout')), QUEUE_TIMEOUT_MS)),
  ])
  return result as unknown as Array<Record<string, unknown>>
}

async function claimTaskViaApi(taskId: string): Promise<boolean> {
  const result = await Promise.race([
    _claimTask(taskId, EXECUTOR_ID),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('claimTask timeout')), QUEUE_TIMEOUT_MS)),
  ])
  return result !== null
}

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to console
// ---------------------------------------------------------------------------

import { appendFileSync } from 'node:fs'
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
  steerAgent(taskId: string, message: string): Promise<void>
  killAgent(taskId: string): void
  onTaskTerminal(taskId: string, status: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentManager(
  config: AgentManagerConfig,
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
  const agentPromises = new Set<Promise<void>>()
  let orphanRecoveryRunning = false
  const depIndex = createDependencyIndex()

  async function onTaskTerminal(taskId: string, status: string): Promise<void> {
    try {
      await resolveDependents(taskId, status, depIndex, getTask, updateTask, logger)
    } catch (err) {
      logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
    }
  }

  // ---- Helpers ----

  function isRateLimitMessage(msg: unknown): boolean {
    if (typeof msg !== 'object' || msg === null) return false
    const m = msg as Record<string, unknown>
    return m.type === 'system' && m.subtype === 'rate_limit'
  }

  function getNumericField(msg: unknown, field: string): number | undefined {
    if (typeof msg !== 'object' || msg === null) return undefined
    const val = (msg as Record<string, unknown>)[field]
    return typeof val === 'number' ? val : undefined
  }

  function isActive(taskId: string): boolean {
    return activeAgents.has(taskId)
  }

  function resolveRepoPath(repoSlug: string): string | null {
    const repoPaths = getRepoPaths()
    return repoPaths[repoSlug.toLowerCase()] ?? null
  }

  // ---- runAgent ----

  async function runAgent(
    task: { id: string; title: string; prompt: string | null; spec: string | null; repo: string; retry_count: number; fast_fail_count: number },
    worktree: { worktreePath: string; branch: string },
    repoPath: string,
  ): Promise<void> {
    const prompt = (task.prompt || task.spec || task.title || '').trim()
    if (!prompt) {
      logger.error(`[agent-manager] Task ${task.id} has no prompt/spec/title — marking error`)
      await updateTask(task.id, { status: 'error', completed_at: new Date().toISOString(), notes: 'Empty prompt' })
      await onTaskTerminal(task.id, 'error')
      cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
      return
    }

    let handle: AgentHandle
    try {
      handle = await Promise.race([
        spawnAgent({
          prompt,
          cwd: worktree.worktreePath,
          model: config.defaultModel,
          logger,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)), SPAWN_TIMEOUT_MS)),
      ])
    } catch (err) {
      logger.error(`[agent-manager] spawnAgent failed for task ${task.id}: ${err}`)
      await updateTask(task.id, { status: 'error', completed_at: new Date().toISOString(), notes: `Spawn failed: ${err instanceof Error ? err.message : String(err)}` }).catch((err) => logger.warn(`[agent-manager] Failed to update task ${task.id} after spawn failure: ${err}`))
      await onTaskTerminal(task.id, 'error')
      cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
      return
    }

    const agentRunId = randomUUID()
    const agent: ActiveAgent = {
      taskId: task.id,
      agentRunId,
      handle,
      model: config.defaultModel,
      startedAt: Date.now(),
      lastOutputAt: Date.now(),
      rateLimitCount: 0,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
    }
    activeAgents.set(task.id, agent)
    // Persist agent_run_id so LogDrawer can find logs after restart
    await updateTask(task.id, { agent_run_id: agentRunId }).catch((err) =>
      logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
    )
    concurrency = { ...concurrency, activeCount: concurrency.activeCount + 1 }

    // Consume messages
    let exitCode: number | undefined
    try {
      for await (const msg of handle.messages) {
        agent.lastOutputAt = Date.now()

        // Track rate-limit events
        if (isRateLimitMessage(msg)) {
          agent.rateLimitCount++
        }
        // Track cost / tokens if present
        agent.costUsd = getNumericField(msg, 'cost_usd') ?? agent.costUsd
        agent.tokensIn = getNumericField(msg, 'tokens_in') ?? agent.tokensIn
        agent.tokensOut = getNumericField(msg, 'tokens_out') ?? agent.tokensOut
        // Track exit code if present (typically in last message)
        exitCode = getNumericField(msg, 'exit_code') ?? exitCode
      }
    } catch (err) {
      logger.error(`[agent-manager] Error consuming messages for task ${task.id}: ${err}`)
    }

    // Agent exited
    const exitedAt = Date.now()

    // Check if watchdog already cleaned up this agent
    if (!activeAgents.has(task.id)) {
      logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
      cleanupWorktree({
        repoPath,
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
      })
      return
    }

    activeAgents.delete(task.id)
    concurrency = { ...concurrency, activeCount: Math.max(0, concurrency.activeCount - 1) }

    // Classify exit (default to exit code 1 if not available, assuming failure)
    const ffResult = classifyExit(agent.startedAt, exitedAt, exitCode ?? 1, task.fast_fail_count ?? 0)
    const now = new Date().toISOString()

    if (ffResult === 'fast-fail-exhausted') {
      await updateTask(task.id, { status: 'error', completed_at: now, notes: 'Fast-fail exhausted' })
      await onTaskTerminal(task.id, 'error')
    } else if (ffResult === 'fast-fail-requeue') {
      await updateTask(task.id, {
        status: 'queued',
        fast_fail_count: (task.fast_fail_count ?? 0) + 1,
        claimed_by: null,
      })
    } else {
      // Normal exit — attempt success resolution
      try {
        const ghRepo = getGhRepo(task.repo) ?? task.repo

        await resolveSuccess({
          taskId: task.id,
          worktreePath: worktree.worktreePath,
          title: task.title,
          ghRepo,
        }, logger)
      } catch (err) {
        logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)
        await resolveFailure({ taskId: task.id, retryCount: task.retry_count ?? 0 })
        if ((task.retry_count ?? 0) >= MAX_RETRIES) {
          await onTaskTerminal(task.id, 'failed')
        }
      }
    }

    // Cleanup worktree (fire-and-forget)
    cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
    })

    logger.info(`[agent-manager] Agent completed for task ${task.id} (${ffResult})`)
  }

  // ---- drainLoop ----

  async function drainLoop(): Promise<void> {
    logger.info(`[agent-manager] Drain loop starting (shuttingDown=${shuttingDown}, slots=${availableSlots(concurrency)})`)
    if (shuttingDown) return

    // Skip if orphan recovery is currently running to prevent race conditions
    if (orphanRecoveryRunning) {
      logger.info('[agent-manager] Skipping drain loop - orphan recovery in progress')
      return
    }

    // Refresh dependency index each drain cycle to pick up tasks created
    // since startup or since the last drain. Rebuild is O(n) and cheap.
    try {
      const allTasks = await getTasksWithDependencies()
      depIndex.rebuild(allTasks)
    } catch (err) {
      logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
    }

    const available = availableSlots(concurrency)
    if (available <= 0) return

    try {
      // Auth is validated by the SDK at spawn time — no explicit check here.
      // checkAuthStatus() hangs in Electron due to Keychain access blocking.

      logger.info(`[agent-manager] Fetching queued tasks via Queue API (limit=${available})...`)
      const queued = await fetchQueuedTasks(available)
      logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
      for (const raw of queued) {
        if (shuttingDown) break

        try {
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
          }

          const repoPath = resolveRepoPath(task.repo)
          if (!repoPath) {
            logger.warn(`[agent-manager] No repo path for "${task.repo}" — skipping task ${task.id}`)
            continue
          }

          const claimed = await claimTaskViaApi(task.id)
          if (!claimed) {
            logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
            continue
          }

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
            logger.error(`[agent-manager] setupWorktree failed for task ${task.id}: ${err}`)
            await updateTask(task.id, { status: 'error', completed_at: new Date().toISOString() })
            await onTaskTerminal(task.id, 'error')
            continue
          }

          // Fire-and-forget — errors logged inside runAgent
          const p = runAgent(task, wt, repoPath).catch((err) => {
            logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
          }).finally(() => { agentPromises.delete(p) })
          agentPromises.add(p)
        } catch (err) {
          logger.error(`[agent-manager] Failed to process task ${raw.id}: ${err}`)
          continue
        }
      }
    } catch (err) {
      logger.error(`[agent-manager] Drain loop error: ${err}`)
    }

    concurrency = tryRecover(concurrency, Date.now())
  }

  // ---- watchdogLoop ----

  function watchdogLoop(): void {
    for (const agent of activeAgents.values()) {
      const verdict = checkAgent(agent, Date.now(), config)
      if (verdict === 'ok') continue

      logger.warn(`[agent-manager] Watchdog killing task ${agent.taskId}: ${verdict}`)
      agent.handle.abort()

      // Delete agent and decrement concurrency immediately to prevent race with runAgent cleanup
      activeAgents.delete(agent.taskId)
      concurrency = { ...concurrency, activeCount: Math.max(0, concurrency.activeCount - 1) }

      // Update task based on verdict
      const now = new Date().toISOString()
      if (verdict === 'max-runtime') {
        updateTask(agent.taskId, { status: 'error', completed_at: now, notes: 'Max runtime exceeded' })
          .then(() => onTaskTerminal(agent.taskId, 'error'))
          .catch((err) => logger.warn(`[agent-manager] Failed to update task ${agent.taskId} after max-runtime kill: ${err}`))
      } else if (verdict === 'idle') {
        updateTask(agent.taskId, { status: 'error', completed_at: now, notes: 'Idle timeout' })
          .then(() => onTaskTerminal(agent.taskId, 'error'))
          .catch((err) => logger.warn(`[agent-manager] Failed to update task ${agent.taskId} after idle kill: ${err}`))
      } else if (verdict === 'rate-limit-loop') {
        concurrency = applyBackpressure(concurrency, Date.now())
        updateTask(agent.taskId, { status: 'queued', claimed_by: null, notes: 'Rate-limit loop — re-queued' }).catch((err) => logger.warn(`[agent-manager] Failed to requeue rate-limited task ${agent.taskId}: ${err}`))
      }
    }
  }

  // ---- orphanLoop ----

  async function orphanLoop(): Promise<void> {
    orphanRecoveryRunning = true
    try {
      await recoverOrphans(isActive, logger)
    } catch (err) {
      logger.error(`[agent-manager] Orphan recovery error: ${err}`)
    } finally {
      orphanRecoveryRunning = false
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
    recoverOrphans(isActive, logger).catch((err) => {
      logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
    })

    // Build dependency index
    getTasksWithDependencies().then((tasks) => {
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
      agent.handle.abort()
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
      concurrency: { ...concurrency },
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

  async function steerAgent(taskId: string, message: string): Promise<void> {
    const agent = activeAgents.get(taskId)
    if (!agent) throw new Error(`No active agent for task ${taskId}`)
    await agent.handle.steer(message)
  }

  function killAgent(taskId: string): void {
    const agent = activeAgents.get(taskId)
    if (!agent) throw new Error(`No active agent for task ${taskId}`)
    agent.handle.abort()
  }

  return { start, stop, getStatus, steerAgent, killAgent, onTaskTerminal }
}
