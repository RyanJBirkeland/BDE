import type { AgentManagerConfig, ActiveAgent, AgentHandle } from './types'
import {
  EXECUTOR_ID,
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
} from './types'
import {
  makeConcurrencyState,
  availableSlots,
  tryRecover,
  type ConcurrencyState,
} from './concurrency'
import { checkAgent } from './watchdog'
import { classifyExit } from './fast-fail'
import { setupWorktree, cleanupWorktree, pruneStaleWorktrees } from './worktree'
import { spawnAgent } from './sdk-adapter'
import { resolveSuccess, resolveFailure } from './completion'
import { recoverOrphans } from './orphan-recovery'
import { getQueuedTasks, claimTask, updateTask } from '../data/sprint-queries'
import { checkAuthStatus } from '../auth-guard'
import { getRepoPaths } from '../paths'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to console
// ---------------------------------------------------------------------------

interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

const defaultLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
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

  // ---- Helpers ----

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
    const prompt = task.prompt || task.spec || task.title
    const handle: AgentHandle = await spawnAgent({
      prompt,
      cwd: worktree.worktreePath,
      model: config.defaultModel,
    })

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
    concurrency = { ...concurrency, activeCount: concurrency.activeCount + 1 }

    // Consume messages
    try {
      for await (const msg of handle.messages) {
        agent.lastOutputAt = Date.now()

        // Track rate-limit events
        const m = msg as Record<string, unknown>
        if (m.type === 'system' && m.subtype === 'rate_limit') {
          agent.rateLimitCount++
        }
        // Track cost / tokens if present
        if (typeof m.cost_usd === 'number') agent.costUsd = m.cost_usd as number
        if (typeof m.tokens_in === 'number') agent.tokensIn = m.tokens_in as number
        if (typeof m.tokens_out === 'number') agent.tokensOut = m.tokens_out as number
      }
    } catch (err) {
      logger.error(`[agent-manager] Error consuming messages for task ${task.id}: ${err}`)
    }

    // Agent exited
    const exitedAt = Date.now()
    activeAgents.delete(task.id)
    concurrency = { ...concurrency, activeCount: Math.max(0, concurrency.activeCount - 1) }

    // Classify exit
    const ffResult = classifyExit(agent.startedAt, exitedAt, task.fast_fail_count ?? 0)
    const now = new Date().toISOString()

    if (ffResult === 'fast-fail-exhausted') {
      await updateTask(task.id, { status: 'error', completed_at: now, notes: 'Fast-fail exhausted' })
    } else if (ffResult === 'fast-fail-requeue') {
      await updateTask(task.id, {
        status: 'queued',
        fast_fail_count: (task.fast_fail_count ?? 0) + 1,
        claimed_by: null,
      })
    } else {
      // Normal exit — attempt success resolution
      try {
        // Derive ghRepo from configured repos
        const repoPaths = getRepoPaths()
        const ghRepo = Object.entries(repoPaths).find(
          ([, p]) => p === repoPath,
        )?.[0] ?? task.repo

        await resolveSuccess({
          taskId: task.id,
          worktreePath: worktree.worktreePath,
          title: task.title,
          ghRepo,
        })
      } catch (err) {
        logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)
        await resolveFailure({ taskId: task.id, retryCount: task.retry_count ?? 0 })
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
    if (shuttingDown) return

    const available = availableSlots(concurrency)
    if (available <= 0) return

    try {
      const auth = await checkAuthStatus()
      if (!auth.tokenFound || auth.tokenExpired) {
        logger.warn('[agent-manager] Auth token missing or expired — skipping drain')
        return
      }

      const queued = await getQueuedTasks(available)
      for (const task of queued) {
        if (shuttingDown) break

        const repoPath = resolveRepoPath(task.repo)
        if (!repoPath) {
          logger.warn(`[agent-manager] No repo path for "${task.repo}" — skipping task ${task.id}`)
          continue
        }

        const claimed = await claimTask(task.id, EXECUTOR_ID)
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
          })
        } catch (err) {
          logger.error(`[agent-manager] setupWorktree failed for task ${task.id}: ${err}`)
          await updateTask(task.id, { status: 'error', completed_at: new Date().toISOString() })
          continue
        }

        // Fire-and-forget — errors logged inside runAgent
        const p = runAgent(task, wt, repoPath).catch((err) => {
          logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
        }).finally(() => { agentPromises.delete(p) })
        agentPromises.add(p)
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

      // Update task based on verdict
      const now = new Date().toISOString()
      if (verdict === 'max-runtime') {
        updateTask(agent.taskId, { status: 'error', completed_at: now, notes: 'Max runtime exceeded' }).catch(() => {})
      } else if (verdict === 'idle') {
        updateTask(agent.taskId, { status: 'error', completed_at: now, notes: 'Idle timeout' }).catch(() => {})
      } else if (verdict === 'rate-limit-loop') {
        updateTask(agent.taskId, { status: 'error', completed_at: now, notes: 'Rate-limit loop detected' }).catch(() => {})
      }
    }
  }

  // ---- orphanLoop ----

  async function orphanLoop(): Promise<void> {
    try {
      await recoverOrphans(isActive, logger)
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
    recoverOrphans(isActive, logger).catch((err) => {
      logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
    })

    // Initial worktree prune (fire-and-forget)
    pruneStaleWorktrees(config.worktreeBase, isActive).catch((err) => {
      logger.error(`[agent-manager] Initial worktree prune error: ${err}`)
    })

    // Start periodic loops
    pollTimer = setInterval(() => {
      drainInFlight = drainLoop().catch(() => {}).finally(() => { drainInFlight = null })
    }, config.pollIntervalMs)
    watchdogTimer = setInterval(watchdogLoop, WATCHDOG_INTERVAL_MS)
    orphanTimer = setInterval(() => { orphanLoop().catch(() => {}) }, ORPHAN_CHECK_INTERVAL_MS)
    pruneTimer = setInterval(() => { pruneLoop().catch(() => {}) }, WORKTREE_PRUNE_INTERVAL_MS)

    // Run initial drain immediately
    drainInFlight = drainLoop().catch(() => {}).finally(() => { drainInFlight = null })

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

  return { start, stop, getStatus, steerAgent, killAgent }
}
