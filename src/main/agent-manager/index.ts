import type { AgentManagerConfig, ActiveAgent, SteerResult } from './types'
import type { Logger } from '../logger'
import { logError } from '../logger'
import type { TaskDependency } from '../../shared/types'
import { computeDepsFingerprint, refreshDependencyIndex } from './dependency-refresher'
import { handleTaskTerminal } from './terminal-handler'
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
  setMaxSlots,
  availableSlots,
  tryRecover,
  type ConcurrencyState
} from './concurrency'
import { checkAgent } from './watchdog'
import { setupWorktree, pruneStaleWorktrees } from './worktree'
import { recoverOrphans } from './orphan-recovery'
import { createDependencyIndex } from '../services/dependency-service'
import {
  createEpicDependencyIndex,
  type EpicDependencyIndex
} from '../services/epic-dependency-service'
import { runAgent as _runAgent, type RunAgentDeps, type RunAgentTask } from './run-agent'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getRepoPaths } from '../paths'
import { createMetricsCollector, type MetricsCollector, type MetricsSnapshot } from './metrics'
import { getSetting, getSettingJson } from '../settings'
import { flushAgentEventBatcher } from '../agent-event-mapper'
import { CircuitBreaker } from './circuit-breaker'
import { checkOAuthToken } from './oauth-checker'
import { handleWatchdogVerdict } from './watchdog-handler'
import type { WatchdogAction } from './types'
import { mapQueuedTask, checkAndBlockDeps, type MappedTask } from './task-mapper'

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to createLogger
// ---------------------------------------------------------------------------

import { createLogger } from '../logger'

const defaultLogger: Logger = createLogger('agent-manager')

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
  /**
   * Re-read settings from the settings store and hot-update the in-memory
   * config for fields that are safe to change at runtime.
   *
   * Hot-reloadable: maxConcurrent, maxRuntimeMs, idleTimeoutMs, defaultModel.
   * NOT hot-reloadable: worktreeBase (requires restart — existing worktrees
   * would be orphaned). pollIntervalMs also requires restart.
   *
   * Returns which fields changed and which require restart.
   */
  reloadConfig(): {
    updated: string[]
    requiresRestart: string[]
  }
}

// ---------------------------------------------------------------------------
// Class implementation
// ---------------------------------------------------------------------------

import type { DependencyIndex } from '../services/dependency-service'
import { nowIso } from '../../shared/time'

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
  readonly _epicIndex: EpicDependencyIndex
  readonly _metrics: MetricsCollector
  // F-t1-sysprof-1/-4: Cache a stable fingerprint alongside the deps array so
  // subsequent drain ticks can short-circuit the deep compare via hash equality.
  // Exposed via _ prefix for testability (private by convention, not keyword).
  _lastTaskDeps = new Map<string, { deps: TaskDependency[] | null; hash: string }>()

  // Idempotency guard — maps taskId to the in-flight terminal promise.
  // Duplicate callers receive the same promise; the entry is deleted in finally.
  private readonly _terminalCalled = new Map<string, Promise<void>>()

  // Set to true when a terminal event fires so the next drain tick performs
  // a full dep index rebuild (instead of the incremental refresh).
  _depIndexDirty = false

  // Circuit breaker — pauses drain loop after consecutive spawn failures.
  private readonly _circuitBreaker: CircuitBreaker

  // Private timers
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private orphanTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  // Injected deps
  private readonly runAgentDeps: RunAgentDeps

  // `config` is mutable so `reloadConfig()` can hot-update fields that are
  // safe to change at runtime. `worktreeBase` is not mutated after construction.
  config: AgentManagerConfig

  constructor(
    config: AgentManagerConfig,
    readonly repo: ISprintTaskRepository,
    readonly logger: Logger = defaultLogger
  ) {
    this.config = config
    this._concurrency = makeConcurrencyState(config.maxConcurrent)
    this._depIndex = createDependencyIndex()
    this._epicIndex = createEpicDependencyIndex()
    this._metrics = createMetricsCollector()
    this._circuitBreaker = new CircuitBreaker(logger)

    // Build runAgentDeps with bound onTaskTerminal
    this.runAgentDeps = {
      activeAgents: this._activeAgents,
      defaultModel: config.defaultModel,
      logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      repo,
      onSpawnSuccess: () => this._circuitBreaker.recordSuccess(),
      onSpawnFailure: () => this._circuitBreaker.recordFailure()
    }
  }

  /**
   * Backward compatibility accessors for tests that check circuit breaker state.
   */
  get _consecutiveSpawnFailures(): number {
    return this._circuitBreaker.failureCount
  }

  get _circuitOpenUntil(): number {
    return this._circuitBreaker.openUntilTimestamp
  }

  /**
   * Backward compatibility — delegates to CircuitBreaker.recordSuccess().
   */
  _recordSpawnSuccess(): void {
    this._circuitBreaker.recordSuccess()
  }

  /**
   * Backward compatibility — delegates to CircuitBreaker.recordFailure().
   */
  _recordSpawnFailure(): void {
    this._circuitBreaker.recordFailure()
  }

  /**
   * Backward compatibility — delegates to CircuitBreaker.isOpen().
   */
  _isCircuitOpen(now?: number): boolean {
    return this._circuitBreaker.isOpen(now)
  }

  // ---- Helpers ----

  private fetchQueuedTasks(limit: number): Array<Record<string, unknown>> {
    return this.repo.getQueuedTasks(limit) as unknown as Array<Record<string, unknown>>
  }

  private claimTask(taskId: string): boolean {
    return this.repo.claimTask(taskId, EXECUTOR_ID) !== null
  }

  /**
   * Incrementally refresh the dependency index from the repository.
   * Delegates to the pure `refreshDependencyIndex` function.
   *
   * Returns a Map<taskId, status> built from the current task list.
   * On repo error, logs a warning and returns an empty map so the drain loop
   * continues with a stale-but-safe state.
   *
   * Exposed via _ prefix convention (not private keyword) for testability.
   */
  _refreshDependencyIndex(): Map<string, string> {
    return refreshDependencyIndex(this._depIndex, this._lastTaskDeps, this.repo, this.logger)
  }

  async onTaskTerminal(taskId: string, status: string): Promise<void> {
    await handleTaskTerminal(taskId, status, this.onTaskTerminal.bind(this), {
      metrics: this._metrics,
      depIndex: this._depIndex,
      epicIndex: this._epicIndex,
      repo: this.repo,
      config: this.config,
      terminalCalled: this._terminalCalled,
      logger: this.logger
    })
    this._depIndexDirty = true
  }

  private resolveRepoPath(repoSlug: string): string | null {
    const repoPaths = getRepoPaths()
    return repoPaths[repoSlug.toLowerCase()] ?? null
  }

  /**
   * Fire-and-forget agent spawn — errors logged inside runAgent.
   */
  _spawnAgent(
    task: RunAgentTask,
    worktree: { worktreePath: string; branch: string },
    repoPath: string
  ): void {
    this._metrics.increment('agentsSpawned')
    const p = _runAgent(task, worktree, repoPath, this.runAgentDeps)
      .catch((err) => {
        this.logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
      })
      .finally(() => {
        this._agentPromises.delete(p)
      })
    this._agentPromises.add(p)
  }

  // ---- processQueuedTask ----

  private async _validateAndClaimTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>
  ): Promise<{ task: MappedTask; repoPath: string } | null> {
    const task = mapQueuedTask(raw, this.logger)
    if (!task) return null

    const rawDeps = raw.dependsOn ?? raw.depends_on
    if (rawDeps && checkAndBlockDeps(task.id, rawDeps, taskStatusMap, this.repo, this._depIndex, this.logger)) return null

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
      } catch (err) {
        this.logger.warn(
          `[agent-manager] Failed to update task ${task.id} after repo resolution failure: ${err}`
        )
      }
      await this.onTaskTerminal(task.id, 'error').catch((err) =>
        this.logger.warn(`[agent-manager] onTerminal failed for ${task.id}: ${err}`)
      )
      return null
    }

    const claimed = this.claimTask(task.id)
    if (!claimed) {
      this.logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
      return null
    }

    return { task, repoPath }
  }

  private async _prepareWorktreeForTask(
    task: MappedTask,
    repoPath: string
  ): Promise<{ worktreePath: string; branch: string } | null> {
    try {
      return await setupWorktree({
        repoPath,
        worktreeBase: this.config.worktreeBase,
        taskId: task.id,
        title: task.title,
        groupId: task.group_id ?? undefined,
        logger: this.logger
      })
    } catch (err) {
      logError(this.logger, `[agent-manager] setupWorktree failed for task ${task.id}`, err)
      const errMsg = err instanceof Error ? err.message : String(err)
      const fullNote = `Worktree setup failed: ${errMsg}`
      const notes =
        fullNote.length > NOTES_MAX_LENGTH
          ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3))
          : fullNote
      this.repo.updateTask(task.id, {
        status: 'error',
        completed_at: nowIso(),
        notes,
        claimed_by: null
      })
      await this.onTaskTerminal(task.id, 'error').catch((err) =>
        this.logger.warn(`[agent-manager] onTerminal failed for ${task.id}: ${err}`)
      )
      return null
    }
  }

  async _processQueuedTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>
  ): Promise<void> {
    const taskId = raw.id as string
    if (this._processingTasks.has(taskId)) return
    this._processingTasks.add(taskId)
    try {
      const claimed = await this._validateAndClaimTask(raw, taskStatusMap)
      if (!claimed) return

      const { task, repoPath } = claimed

      try {
        const freshTasks = this.repo.getTasksWithDependencies()
        taskStatusMap.clear()
        for (const t of freshTasks) {
          taskStatusMap.set(t.id, t.status)
        }
      } catch {
        // non-fatal: stale map is better than aborting the drain
      }

      const wt = await this._prepareWorktreeForTask(task, repoPath)
      if (!wt) return

      this._spawnAgent(task, wt, repoPath)
    } finally {
      this._processingTasks.delete(taskId)
    }
  }

  // ---- static helpers ----

  /**
   * Backward compat delegate — tests that call `AgentManagerImpl._depsFingerprint`
   * directly continue to work. New code should import `computeDepsFingerprint`
   * from `dependency-refresher.ts` directly.
   */
  static _depsFingerprint(deps: TaskDependency[] | null): string {
    return computeDepsFingerprint(deps)
  }

  // ---- drainLoop helpers ----

  /**
   * Guard checks before running a drain tick.
   * Returns false (and logs as needed) if the drain should be skipped.
   *
   * Exposed via _ prefix for testability.
   */
  async _validateDrainPreconditions(): Promise<boolean> {
    if (this._shuttingDown) return false
    if (this._isCircuitOpen()) {
      this.logger.warn(
        `[agent-manager] Skipping drain — circuit breaker open until ${new Date(
          this._circuitOpenUntil
        ).toISOString()}`
      )
      return false
    }
    const tokenOk = await checkOAuthToken(this.logger)
    if (!tokenOk) {
      this.logger.warn('[drain] OAuth token invalid — skipping drain tick')
      return false
    }
    return true
  }

  /**
   * Fetch queued tasks (up to `available` slots) and process each one.
   * Stops early if `_shuttingDown` is set or slots are exhausted mid-loop.
   * Errors from individual tasks are logged but do not stop the loop.
   *
   * Exposed via _ prefix for testability.
   */
  async _drainQueuedTasks(
    available: number,
    taskStatusMap: Map<string, string>
  ): Promise<void> {
    this.logger.info(`[agent-manager] Fetching queued tasks (limit=${available})...`)
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
  }

  // ---- drainLoop ----

  async _drainLoop(): Promise<void> {
    // Note: concurrency guard is handled by caller via _drainInFlight check
    this.logger.info(
      `[agent-manager] Drain loop starting (shuttingDown=${this._shuttingDown}, slots=${availableSlots(this._concurrency, this._activeAgents.size)})`
    )
    if (!(await this._validateDrainPreconditions())) return

    this._metrics.increment('drainLoopCount')
    const drainStart = Date.now()

    // Full rebuild on dirty flag (terminal event fired since last tick);
    // otherwise incremental refresh.
    let taskStatusMap: Map<string, string>
    if (this._depIndexDirty) {
      const allTasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(allTasks)
      this._lastTaskDeps.clear()
      for (const task of allTasks) {
        const deps = task.depends_on ?? null
        this._lastTaskDeps.set(task.id, { deps, hash: computeDepsFingerprint(deps) })
      }
      taskStatusMap = new Map(allTasks.map((task) => [task.id, task.status]))
      this._depIndexDirty = false
    } else {
      taskStatusMap = this._refreshDependencyIndex()
    }

    const available = availableSlots(this._concurrency, this._activeAgents.size)
    if (available <= 0) return

    try {
      await this._drainQueuedTasks(available, taskStatusMap)
    } catch (err) {
      this.logger.error(`[agent-manager] Drain loop error: ${err}`)
    }

    this._metrics.setLastDrainDuration(Date.now() - drainStart)
    this._concurrency = tryRecover(this._concurrency, Date.now())
  }

  // ---- watchdogLoop ----

  /**
   * Abort an active agent's handle and send SIGKILL to its subprocess if available,
   * then remove it from the active agents map.
   * SDK may not expose process — revisit when SDK exposes subprocess handle.
   */
  private killActiveAgent(agent: ActiveAgent): void {
    try {
      agent.handle.abort()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proc = (agent.handle as any).process
      if (proc && typeof proc.kill === 'function') {
        proc.kill('SIGKILL')
      }
    } catch (err) {
      this.logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
    }
    // Delete agent — activeCount is derived from activeAgents.size
    this._activeAgents.delete(agent.taskId)
  }

  _watchdogLoop(): void {
    // Collect agents to kill before iterating to avoid mutating Map during iteration
    const agentsToKill: Array<{ agent: ActiveAgent; verdict: WatchdogAction }> = []
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

      this.killActiveAgent(agent)

      // Get verdict decision, then apply side effects
      const now = nowIso()
      const maxRuntimeMs = agent.maxRuntimeMs ?? this.config.maxRuntimeMs
      const result = handleWatchdogVerdict(verdict, this._concurrency, now, maxRuntimeMs)
      this._concurrency = result.concurrency

      if (result.taskUpdate) {
        try {
          this.repo.updateTask(agent.taskId, result.taskUpdate)
        } catch (err) {
          this.logger.warn(
            `[agent-manager] Failed to update task ${agent.taskId} after ${verdict}: ${err}`
          )
        }
      }
      if (result.shouldNotifyTerminal && result.terminalStatus) {
        this.onTaskTerminal(agent.taskId, result.terminalStatus).catch((err) =>
          this.logger.warn(
            `[agent-manager] Failed onTerminal for task ${agent.taskId} after ${verdict}: ${err}`
          )
        )
      }
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

    // Startup sweep: clear any stale claimed_by from the previous process session.
    // This covers tasks in any status (e.g. 'review', 'queued') that were left with
    // a non-null claimed_by when the previous process exited. Orphan recovery only
    // re-queues active tasks — this sweep handles all other statuses so no task is
    // claimed-forever after a restart.
    try {
      const cleared = this.repo.clearStaleClaimedBy(EXECUTOR_ID)
      if (cleared > 0) {
        this.logger.info(
          `[agent-manager] Cleared stale claimed_by from ${cleared} task(s) on startup`
        )
      }
    } catch (err) {
      this.logger.error(`[agent-manager] Startup claimed_by sweep failed: ${err}`)
    }

    // Initial orphan recovery (fire-and-forget)
    recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger).catch(
      (err) => {
        this.logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
      }
    )

    // Build dependency index and initialize dependency tracking
    try {
      const tasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(tasks)
      const groups = this.repo.getGroupsWithDependencies()
      this._epicIndex.rebuild(groups)
      // Initialize _lastTaskDeps to avoid false positives on first drain
      this._lastTaskDeps.clear()
      for (const task of tasks) {
        const deps = task.depends_on ?? null
        this._lastTaskDeps.set(task.id, {
          deps,
          hash: computeDepsFingerprint(deps)
        })
      }
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

  // finalizeAgentRun includes git rebase + PR creation which can take 30+ seconds
  async stop(timeoutMs = 60_000): Promise<void> {
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
      await this._drainInFlight.catch((err) => {
        logError(this.logger, '[agent-manager] Drain in-flight failed during shutdown', err)
      })
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

    // Flush any pending agent events to SQLite before shutdown
    flushAgentEventBatcher()

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

  reloadConfig(): { updated: string[]; requiresRestart: string[] } {
    const updated: string[] = []
    const requiresRestart: string[] = []

    const newMaxConcurrent = getSettingJson<number>('agentManager.maxConcurrent')
    if (typeof newMaxConcurrent === 'number' && newMaxConcurrent !== this.config.maxConcurrent) {
      this.config.maxConcurrent = newMaxConcurrent
      // Update the cap in place — preserving activeCount so in-flight agents
      // are still accounted for. If lowered below activeCount, availableSlots
      // returns 0 until enough agents drain. If raised, new slots are
      // immediately available. See `setMaxSlots` for the contract.
      setMaxSlots(this._concurrency, newMaxConcurrent)
      updated.push('maxConcurrent')
    }

    const newMaxRuntimeMs = getSettingJson<number>('agentManager.maxRuntimeMs')
    if (typeof newMaxRuntimeMs === 'number' && newMaxRuntimeMs !== this.config.maxRuntimeMs) {
      this.config.maxRuntimeMs = newMaxRuntimeMs
      updated.push('maxRuntimeMs')
    }

    const newDefaultModel = getSetting('agentManager.defaultModel')
    if (newDefaultModel && newDefaultModel !== this.config.defaultModel) {
      this.config.defaultModel = newDefaultModel
      // Also update runAgentDeps.defaultModel so newly spawned agents see it.
      this.runAgentDeps.defaultModel = newDefaultModel
      updated.push('defaultModel')
    }

    const newWorktreeBase = getSetting('agentManager.worktreeBase')
    if (newWorktreeBase && newWorktreeBase !== this.config.worktreeBase) {
      requiresRestart.push('worktreeBase')
    }

    if (updated.length > 0) {
      this.logger.info(`[agent-manager] Hot-reloaded config fields: ${updated.join(', ')}`)
    }
    if (requiresRestart.length > 0) {
      this.logger.info(
        `[agent-manager] Config fields changed that require restart: ${requiresRestart.join(', ')}`
      )
    }
    return { updated, requiresRestart }
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
