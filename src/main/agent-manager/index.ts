import type { AgentManagerConfig, ActiveAgent, SteerResult, Logger } from './types'
import {
  EXECUTOR_ID,
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
  INITIAL_DRAIN_DEFER_MS,
  NOTES_MAX_LENGTH
} from './types'
import {
  makeConcurrencyState,
  availableSlots,
  applyBackpressure,
  tryRecover,
  type ConcurrencyState
} from './concurrency'
import { checkAgent } from './watchdog'
import { setupWorktree, pruneStaleWorktrees } from './worktree'
import { recoverOrphans } from './orphan-recovery'
import { createDependencyIndex } from './dependency-index'
import { formatBlockedNote } from './dependency-helpers'
import { resolveDependents } from './resolve-dependents'
import { runAgent as _runAgent, type RunAgentDeps, type RunAgentTask } from './run-agent'
import { setSprintQueriesLogger } from '../data/sprint-queries'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getRepoPaths } from '../paths'
import { refreshOAuthTokenFromKeychain, invalidateOAuthToken } from '../env-utils'
import { createMetricsCollector, type MetricsCollector, type MetricsSnapshot } from './metrics'

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to createLogger
// ---------------------------------------------------------------------------

import { readFile, stat } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { homedir as home } from 'node:os'
import { createLogger } from '../logger'

const defaultLogger: Logger = createLogger('agent-manager')

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
    const token = (await readFile(tokenPath, 'utf-8')).trim()
    if (!token || token.length < 20) {
      const refreshed = await refreshOAuthTokenFromKeychain()
      if (refreshed) {
        logger.info('[agent-manager] OAuth token auto-refreshed from Keychain')
        return true
      } else {
        logger.warn(
          '[agent-manager] OAuth token file missing/empty and keychain refresh failed — skipping drain cycle'
        )
        return false
      }
    }

    // Proactively refresh if token file is older than 45 minutes
    // (Claude OAuth tokens expire after ~1 hour)
    try {
      const stats = await stat(tokenPath)
      const ageMs = Date.now() - stats.mtimeMs
      if (ageMs > 45 * 60 * 1000) {
        logger.info('[agent-manager] Token file older than 45min — proactively refreshing')
        const refreshed = await refreshOAuthTokenFromKeychain()
        if (refreshed) {
          invalidateOAuthToken()
          logger.info('[agent-manager] OAuth token proactively refreshed from Keychain')
        }
      }
    } catch {
      /* stat failed — continue with existing token */
    }

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
  updateTaskFn: (id: string, patch: Record<string, unknown>) => unknown,
  onTerminal: (id: string, status: string) => Promise<void>,
  logger: Logger,
  maxRuntimeMs?: number
): ConcurrencyState {
  if (verdict === 'max-runtime') {
    const runtimeMinutes = maxRuntimeMs ? Math.round(maxRuntimeMs / 60000) : 60
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes: `Agent exceeded the maximum runtime of ${runtimeMinutes} minutes. The task may be too large for a single agent session. Consider breaking it into smaller subtasks.`,
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(
          `[agent-manager] Failed onTerminal for task ${taskId} after max-runtime kill: ${err}`
        )
      )
    } catch (err) {
      logger.warn(`[agent-manager] Failed to update task ${taskId} after max-runtime kill: ${err}`)
    }
  } else if (verdict === 'idle') {
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        notes:
          "Agent produced no output for 15 minutes. The agent may be stuck or rate-limited. Check agent events for the last activity. To retry: reset task status to 'queued'.",
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(`[agent-manager] Failed onTerminal for task ${taskId} after idle kill: ${err}`)
      )
    } catch (err) {
      logger.warn(`[agent-manager] Failed to update task ${taskId} after idle kill: ${err}`)
    }
  } else if (verdict === 'rate-limit-loop') {
    concurrency = applyBackpressure(concurrency, Date.now())
    try {
      updateTaskFn(taskId, {
        status: 'queued',
        claimed_by: null,
        notes:
          'Agent hit API rate limits 10+ times and was re-queued with lower concurrency. This usually resolves automatically. If it persists, reduce maxConcurrent in Settings or wait for rate limit cooldown.'
      })
    } catch (err) {
      logger.warn(`[agent-manager] Failed to requeue rate-limited task ${taskId}: ${err}`)
    }
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
  getMetrics(): MetricsSnapshot
  steerAgent(taskId: string, message: string): Promise<SteerResult>
  killAgent(taskId: string): { killed: boolean; error?: string }
  onTaskTerminal(taskId: string, status: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Class implementation
// ---------------------------------------------------------------------------

import type { DependencyIndex } from './dependency-index'

export class AgentManagerImpl implements AgentManager {
  // Exposed state (testable via _ prefix)
  _concurrency: ConcurrencyState
  readonly _activeAgents = new Map<string, ActiveAgent>()
  readonly _processingTasks = new Set<string>()
  _running = false
  _shuttingDown = false
  _drainInFlight: Promise<void> | null = null
  readonly _agentPromises = new Set<Promise<void>>()
  readonly _depIndex: DependencyIndex
  readonly _metrics: MetricsCollector

  // Private timers
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private orphanTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  // Injected deps
  private readonly runAgentDeps: RunAgentDeps

  constructor(
    readonly config: AgentManagerConfig,
    readonly repo: ISprintTaskRepository,
    readonly logger: Logger = defaultLogger
  ) {
    this._concurrency = makeConcurrencyState(config.maxConcurrent)
    this._depIndex = createDependencyIndex()
    this._metrics = createMetricsCollector()

    // Wire sprint-queries to use the same structured file logger as the agent manager
    setSprintQueriesLogger(logger)

    // Build runAgentDeps with bound onTaskTerminal
    this.runAgentDeps = {
      activeAgents: this._activeAgents,
      defaultModel: config.defaultModel,
      logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      repo
    }
  }

  // ---- Helpers ----

  private fetchQueuedTasks(limit: number): Array<Record<string, unknown>> {
    return this.repo.getQueuedTasks(limit) as unknown as Array<Record<string, unknown>>
  }

  private claimTaskViaApi(taskId: string): boolean {
    return this.repo.claimTask(taskId, EXECUTOR_ID) !== null
  }

  async onTaskTerminal(taskId: string, status: string): Promise<void> {
    if (status === 'done' || status === 'review') {
      this._metrics.increment('agentsCompleted')
    } else if (status === 'failed' || status === 'error') {
      this._metrics.increment('agentsFailed')
    }
    if (this.config.onStatusTerminal) {
      this.config.onStatusTerminal(taskId, status)
    } else {
      try {
        resolveDependents(
          taskId,
          status,
          this._depIndex,
          this.repo.getTask,
          this.repo.updateTask,
          this.logger
        )
      } catch (err) {
        this.logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
      }
    }
  }

  private resolveRepoPath(repoSlug: string): string | null {
    const repoPaths = getRepoPaths()
    return repoPaths[repoSlug.toLowerCase()] ?? null
  }

  // ---- processQueuedTask helpers ----

  /**
   * Map Queue API camelCase response to local task shape.
   * Ensures retry_count and fast_fail_count default to 0, prompt and spec default to null.
   * Returns null if required fields are missing.
   */
  _mapQueuedTask(raw: Record<string, unknown>): {
    id: string
    title: string
    prompt: string | null
    spec: string | null
    repo: string
    retry_count: number
    fast_fail_count: number
    notes: string | null
    playground_enabled: boolean
    max_runtime_ms: number | null
  } | null {
    // Validate required fields
    if (!raw.id || typeof raw.id !== 'string') {
      this.logger.warn(`[agent-manager] Task missing or invalid 'id' field: ${JSON.stringify(raw)}`)
      return null
    }
    if (!raw.title || typeof raw.title !== 'string') {
      this.logger.warn(`[agent-manager] Task ${raw.id} missing or invalid 'title' field`)
      return null
    }
    if (!raw.repo || typeof raw.repo !== 'string') {
      this.logger.warn(`[agent-manager] Task ${raw.id} missing or invalid 'repo' field`)
      return null
    }

    return {
      id: raw.id,
      title: raw.title,
      prompt: (raw.prompt as string) ?? null,
      spec: (raw.spec as string) ?? null,
      repo: raw.repo,
      retry_count: Number(raw.retryCount) || 0,
      fast_fail_count: Number(raw.fastFailCount) || 0,
      notes: (raw.notes as string) ?? null,
      playground_enabled: Boolean(raw.playgroundEnabled),
      max_runtime_ms: Number(raw.maxRuntimeMs) || null
    }
  }

  /**
   * Defense-in-depth: check dependencies before claiming.
   * Tasks created via direct API may be 'queued' with unsatisfied deps.
   * Returns true if the task was blocked (caller should return early), false to continue.
   */
  _checkAndBlockDeps(
    taskId: string,
    rawDeps: unknown,
    taskStatusMap: Map<string, string>
  ): boolean {
    try {
      const deps = typeof rawDeps === 'string' ? JSON.parse(rawDeps) : rawDeps
      if (Array.isArray(deps) && deps.length > 0) {
        const { satisfied, blockedBy } = this._depIndex.areDependenciesSatisfied(
          taskId,
          deps,
          (depId: string) => taskStatusMap.get(depId)
        )
        if (!satisfied) {
          this.logger.info(
            `[agent-manager] Task ${taskId} has unsatisfied deps [${blockedBy.join(', ')}] — auto-blocking`
          )
          try {
            this.repo.updateTask(taskId, {
              status: 'blocked',
              notes: formatBlockedNote(blockedBy)
            })
          } catch {
            /* best-effort */
          }
          return true
        }
      }
    } catch (err) {
      // If dep parsing fails, set task to error instead of silently proceeding
      this.logger.error(`[agent-manager] Task ${taskId} has malformed depends_on data: ${err}`)
      try {
        this.repo.updateTask(taskId, {
          status: 'error',
          notes: 'Malformed depends_on field - cannot validate dependencies',
          claimed_by: null
        })
      } catch (updateErr) {
        this.logger.warn(
          `[agent-manager] Failed to update task ${taskId} after dep parse error: ${updateErr}`
        )
      }
      return true // Block the task
    }
    return false
  }

  /**
   * Fire-and-forget agent spawn — errors logged inside runAgent.
   */
  _spawnAgent(
    task: RunAgentTask,
    wt: { worktreePath: string; branch: string },
    repoPath: string
  ): void {
    this._metrics.increment('agentsSpawned')
    const p = _runAgent(task, wt, repoPath, this.runAgentDeps)
      .catch((err) => {
        this.logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
      })
      .finally(() => {
        this._agentPromises.delete(p)
      })
    this._agentPromises.add(p)
  }

  // ---- processQueuedTask ----

  async _processQueuedTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>
  ): Promise<void> {
    const taskId = raw.id as string
    if (this._processingTasks.has(taskId)) return
    this._processingTasks.add(taskId)
    try {
      const task = this._mapQueuedTask(raw)
      if (!task) return // Skip tasks with invalid fields

      const rawDeps = raw.dependsOn ?? raw.depends_on
      if (rawDeps && this._checkAndBlockDeps(task.id, rawDeps, taskStatusMap)) return

      const repoPath = this.resolveRepoPath(task.repo)
      if (!repoPath) {
        this.logger.warn(
          `[agent-manager] No repo path for "${task.repo}" — setting task ${task.id} to error`
        )
        try {
          this.repo.updateTask(task.id, {
            status: 'error',
            notes: `Repo "${task.repo}" is not configured in BDE settings. Add it in Settings > Repos, then reset this task to queued.`,
            claimed_by: null
          })
          await this.onTaskTerminal(task.id, 'error')
        } catch (err) {
          this.logger.warn(
            `[agent-manager] Failed to update task ${task.id} after repo resolution failure: ${err}`
          )
        }
        return
      }

      const claimed = this.claimTaskViaApi(task.id)
      if (!claimed) {
        this.logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
        return
      }

      let wt: { worktreePath: string; branch: string }
      try {
        wt = await setupWorktree({
          repoPath,
          worktreeBase: this.config.worktreeBase,
          taskId: task.id,
          title: task.title,
          logger: this.logger
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this.logger.error(`[agent-manager] setupWorktree failed for task ${task.id}: ${errMsg}`)
        // For git errors, keep the tail of the message (contains key diagnostic info)
        const fullNote = `Worktree setup failed: ${errMsg}`
        const notes =
          fullNote.length > NOTES_MAX_LENGTH
            ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3))
            : fullNote
        this.repo.updateTask(task.id, {
          status: 'error',
          completed_at: new Date().toISOString(),
          notes,
          claimed_by: null
        })
        await this.onTaskTerminal(task.id, 'error')
        return
      }

      this._spawnAgent(task, wt, repoPath)
    } finally {
      this._processingTasks.delete(taskId)
    }
  }

  // ---- drainLoop ----

  async _drainLoop(): Promise<void> {
    // Note: concurrency guard is handled by caller via _drainInFlight check
    this.logger.info(
      `[agent-manager] Drain loop starting (shuttingDown=${this._shuttingDown}, slots=${availableSlots(this._concurrency, this._activeAgents.size)})`
    )
    if (this._shuttingDown) return
    this._metrics.increment('drainLoopCount')
    const drainStart = Date.now()

    // Refresh dependency index each drain cycle to pick up tasks created
    // since startup or since the last drain. Rebuild is O(n) and cheap.
    let taskStatusMap = new Map<string, string>()
    try {
      const allTasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(allTasks)
      taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]))
    } catch (err) {
      this.logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
    }

    const available = availableSlots(this._concurrency, this._activeAgents.size)
    if (available <= 0) return

    try {
      const tokenOk = await checkOAuthToken(this.logger)
      if (!tokenOk) return

      this.logger.info(
        `[agent-manager] Fetching queued tasks via Queue API (limit=${available})...`
      )
      const queued = this.fetchQueuedTasks(available)
      this.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
      for (const raw of queued) {
        if (this._shuttingDown) break
        // Re-check slots before each task — an earlier iteration may have filled a slot
        if (availableSlots(this._concurrency, this._activeAgents.size) <= 0) {
          this.logger.info('[agent-manager] No slots available — stopping drain iteration')
          break
        }
        try {
          await this._processQueuedTask(raw, taskStatusMap)
        } catch (err) {
          this.logger.error(
            `[agent-manager] Failed to process task ${(raw as Record<string, unknown>).id}: ${err}`
          )
        }
      }
    } catch (err) {
      this.logger.error(`[agent-manager] Drain loop error: ${err}`)
    }

    this._metrics.setLastDrainDuration(Date.now() - drainStart)
    this._concurrency = tryRecover(this._concurrency, Date.now())
  }

  // ---- watchdogLoop ----

  _watchdogLoop(): void {
    // Collect agents to kill before iterating to avoid mutating Map during iteration
    const agentsToKill: Array<{ agent: ActiveAgent; verdict: WatchdogVerdict }> = []
    for (const agent of this._activeAgents.values()) {
      if (this._processingTasks.has(agent.taskId)) continue
      const verdict = checkAgent(agent, Date.now(), this.config)
      if (verdict !== 'ok') {
        agentsToKill.push({ agent, verdict })
      }
    }

    // Process kills
    for (const { agent, verdict } of agentsToKill) {
      this.logger.warn(`[agent-manager] Watchdog killing task ${agent.taskId}: ${verdict}`)
      this._metrics.recordWatchdogVerdict(verdict)
      if (verdict === 'rate-limit-loop') {
        this._metrics.increment('retriesQueued')
      }
      try {
        agent.handle.abort()
      } catch (err) {
        this.logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
      }

      // Delete agent — activeCount is derived from activeAgents.size
      this._activeAgents.delete(agent.taskId)

      // Update task based on verdict
      const now = new Date().toISOString()
      const maxRuntimeMs = agent.maxRuntimeMs ?? this.config.maxRuntimeMs
      this._concurrency = handleWatchdogVerdict(
        verdict,
        agent.taskId,
        this._concurrency,
        now,
        this.repo.updateTask,
        this.onTaskTerminal.bind(this),
        this.logger,
        maxRuntimeMs
      )
    }
  }

  // ---- orphanLoop ----

  private async _orphanLoop(): Promise<void> {
    try {
      await recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger)
    } catch (err) {
      this.logger.error(`[agent-manager] Orphan recovery error: ${err}`)
    }
  }

  // ---- pruneLoop ----

  private _isReviewTask(taskId: string): boolean {
    try {
      const task = this.repo.getTask(taskId)
      return task?.status === 'review'
    } catch {
      return false
    }
  }

  private async _pruneLoop(): Promise<void> {
    try {
      await pruneStaleWorktrees(
        this.config.worktreeBase,
        (id: string) => this._activeAgents.has(id),
        this.logger,
        (id: string) => this._isReviewTask(id)
      )
    } catch (err) {
      this.logger.error(`[agent-manager] Worktree prune error: ${err}`)
    }
  }

  // ---- Public methods ----

  start(): void {
    if (this._running) return
    this._running = true
    this._shuttingDown = false
    this._concurrency = makeConcurrencyState(this.config.maxConcurrent)

    // Initial orphan recovery (fire-and-forget)
    recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger).catch(
      (err) => {
        this.logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
      }
    )

    // Build dependency index
    try {
      const tasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(tasks)
      this.logger.info(`[agent-manager] Dependency index built with ${tasks.length} tasks`)
    } catch (err) {
      this.logger.error(`[agent-manager] Failed to build dependency index: ${err}`)
    }

    // Initial worktree prune (fire-and-forget)
    pruneStaleWorktrees(
      this.config.worktreeBase,
      (id: string) => this._activeAgents.has(id),
      this.logger,
      (id: string) => this._isReviewTask(id)
    ).catch((err) => {
      this.logger.error(`[agent-manager] Initial worktree prune error: ${err}`)
    })

    // Start periodic loops
    this.pollTimer = setInterval(() => {
      if (this._drainInFlight) return // skip if previous drain still running
      this._drainInFlight = this._drainLoop()
        .catch((err) => this.logger.warn(`[agent-manager] Drain loop error: ${err}`))
        .finally(() => {
          this._drainInFlight = null
        })
    }, this.config.pollIntervalMs)
    this.watchdogTimer = setInterval(() => this._watchdogLoop(), WATCHDOG_INTERVAL_MS)
    this.orphanTimer = setInterval(() => {
      this._orphanLoop().catch((err) =>
        this.logger.warn(`[agent-manager] Orphan loop error: ${err}`)
      )
    }, ORPHAN_CHECK_INTERVAL_MS)
    this.pruneTimer = setInterval(() => {
      this._pruneLoop().catch((err) => this.logger.warn(`[agent-manager] Prune loop error: ${err}`))
    }, WORKTREE_PRUNE_INTERVAL_MS)

    // Defer initial drain to let the event loop settle and orphan recovery complete
    setTimeout(() => {
      this._drainInFlight = (async () => {
        // Wait for orphan recovery to complete before draining
        try {
          await recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger)
        } catch (err) {
          this.logger.error(`[agent-manager] Orphan recovery before initial drain error: ${err}`)
        }
        await this._drainLoop()
      })()
        .catch((err) => this.logger.warn(`[agent-manager] Initial drain error: ${err}`))
        .finally(() => {
          this._drainInFlight = null
        })
    }, INITIAL_DRAIN_DEFER_MS)

    this.logger.info('[agent-manager] Started')
  }

  async stop(timeoutMs = 10_000): Promise<void> {
    this._shuttingDown = true

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
    if (this.orphanTimer) {
      clearInterval(this.orphanTimer)
      this.orphanTimer = null
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }

    // Wait for any in-flight drain to complete before aborting agents
    if (this._drainInFlight) {
      await this._drainInFlight.catch(() => {})
      this._drainInFlight = null
    }

    // Abort all active agents
    for (const agent of this._activeAgents.values()) {
      try {
        agent.handle.abort()
      } catch (err) {
        this.logger.warn(
          `[agent-manager] Failed to abort agent ${agent.taskId} during shutdown: ${err}`
        )
      }
    }

    // Wait for all agent promises to settle (with timeout)
    if (this._agentPromises.size > 0) {
      const allSettled = Promise.allSettled([...this._agentPromises])
      const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs))
      await Promise.race([allSettled, timeout])
    }

    // Re-queue any tasks that are still active after agent shutdown
    for (const agent of this._activeAgents.values()) {
      try {
        this.repo.updateTask(agent.taskId, {
          status: 'queued',
          claimed_by: null,
          started_at: null,
          notes: 'Task was re-queued due to BDE shutdown while agent was running.'
        })
        this.logger.info(`[agent-manager] Re-queued task ${agent.taskId} during shutdown`)
      } catch (err) {
        this.logger.warn(`[agent-manager] Failed to re-queue task ${agent.taskId}: ${err}`)
      }
    }
    this._activeAgents.clear()

    this._running = false
    this.logger.info('[agent-manager] Stopped')
  }

  getMetrics(): MetricsSnapshot {
    return this._metrics.snapshot()
  }

  getStatus(): AgentManagerStatus {
    return {
      running: this._running,
      shuttingDown: this._shuttingDown,
      concurrency: { ...this._concurrency, activeCount: this._activeAgents.size },
      activeAgents: [...this._activeAgents.values()].map((a) => ({
        taskId: a.taskId,
        agentRunId: a.agentRunId,
        model: a.model,
        startedAt: a.startedAt,
        lastOutputAt: a.lastOutputAt,
        rateLimitCount: a.rateLimitCount,
        costUsd: a.costUsd,
        tokensIn: a.tokensIn,
        tokensOut: a.tokensOut
      }))
    }
  }

  async steerAgent(taskId: string, message: string): Promise<SteerResult> {
    // Validate message size (max 10KB)
    if (message.length > 10_000) {
      return { delivered: false, error: 'Message exceeds 10KB limit' }
    }

    const agent = this._activeAgents.get(taskId)
    if (!agent) return { delivered: false, error: 'Agent not found' }
    return agent.handle.steer(message)
  }

  killAgent(taskId: string): { killed: boolean; error?: string } {
    const agent = this._activeAgents.get(taskId)
    if (!agent) {
      return { killed: false, error: `No active agent for task ${taskId}` }
    }
    try {
      agent.handle.abort()
      return { killed: true }
    } catch (err) {
      return { killed: false, error: String(err) }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentManager(
  config: AgentManagerConfig,
  repo: ISprintTaskRepository,
  logger: Logger = defaultLogger
): AgentManager {
  return new AgentManagerImpl(config, repo, logger)
}
