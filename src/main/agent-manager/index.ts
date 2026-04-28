import type { AgentManagerConfig, TerminalResolutionStrategy, SteerResult } from './types'
import type { Logger } from '../logger'
import type { SprintTask } from '../../shared/types/task-types'
import type { TaskStatus } from '../../shared/task-state-machine'
import { handleTaskTerminal } from './terminal-handler'
import { createTaskStateService, type TaskStateService } from '../services/task-state-service'
import { EXECUTOR_ID, INITIAL_DRAIN_DEFER_MS } from './types'
import { makeConcurrencyState, availableSlots, type ConcurrencyState } from './concurrency'
import { recoverOrphans } from './orphan-recovery'
import { createDependencyIndex } from '../services/dependency-service'
import { createEpicDependencyIndex, type EpicDepsReader } from '../services/epic-dependency-service'
import { runAgent as _runAgent, type RunAgentDeps, type AgentRunClaim } from './run-agent'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import { createUnitOfWork, type IUnitOfWork } from '../data/unit-of-work'
import { createMetricsCollector, type MetricsCollector, type MetricsSnapshot } from './metrics'
import { CircuitBreaker, type CircuitObserver } from './circuit-breaker'

import type { MappedTask } from './task-mapper'

// Extracted module imports
import { DrainLoop, type DrainLoopDeps } from './drain-loop'
import { runWatchdog, killActiveAgent, type WatchdogLoopDeps } from './watchdog-loop'
import { validateAndClaimTask, prepareWorktreeForTask, processQueuedTask } from './task-claimer'
import { checkIsReviewTask, runPruneLoop } from './worktree-manager'
import { pruneStaleWorktrees, cleanupWorktree } from './worktree'
import { resolveRepoPath } from './task-claimer'
import { executeShutdown } from './shutdown-coordinator'
import { reloadConfiguration } from './config-manager'
import { LifecycleController } from './lifecycle-controller'
import { AgentManagerTestInternals } from './agent-manager-test-internals'
import { WipTracker } from './wip-tracker'
import { ErrorRegistry } from './error-registry'

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to createLogger
// ---------------------------------------------------------------------------

import { createLogger } from '../logger'
import { broadcast } from '../broadcast'
import { sleep } from '../lib/async-utils'
import { SpawnRegistry } from './spawn-registry'
import { TerminalGuard } from './terminal-guard'

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
  /**
   * Abort the running agent for the given task and clear its active-agent
   * registration. No-op when no agent is running for the task.
   * Used by `sprint:forceReleaseClaim` to prevent a detached agent from
   * continuing work against a task that has been re-queued.
   */
  cancelAgent(taskId: string): Promise<void>
  /**
   * Resolves when any in-flight OAuth token refresh initiated by
   * `handleOAuthRefresh` in message-consumer has completed (success or failure).
   * The drain loop awaits this before spawning new agents so the refreshed
   * token is on disk before the next SDK spawn reads it.
   */
  awaitOAuthRefresh(): Promise<void>
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

export class AgentManagerImpl implements AgentManager {
  // ---- Lifecycle flags ----
  private _running = false
  private _shuttingDown = false
  /**
   * Guards against duplicate `start()` calls. A second call while the manager
   * is already started logs a WARN and returns immediately — no new timers are
   * created and no startup side-effects are repeated.
   */
  private _started = false

  // ---- Drain runtime ----
  /** The DrainLoop instance owns all mutable drain state (concurrency, failure counts, pause gate, dep fingerprints). */
  _drainLoopInstance!: DrainLoop // assigned in constructor after deps are ready
  _drainInFlight: Promise<void> | null = null
  // Set when a terminal event fires; next drain tick rebuilds the dep index
  // fully instead of doing an incremental refresh.
  _depIndexDirty = false
  // Drain-tick-level error counter. Reset on any successful tick. Emits
  // `manager:warning` after 3 consecutive failures.
  private _consecutiveDrainErrors = 0

  // Concurrency state is owned by _drainLoopInstance.
  // These accessors delegate for backward compat with test internals and watchdog deps.
  get _concurrency(): ConcurrencyState { return this._drainLoopInstance.getConcurrency() }
  set _concurrency(state: ConcurrencyState) { this._drainLoopInstance.setConcurrency(state) }

  // ---- Spawn tracking ----
  private readonly spawnRegistry = new SpawnRegistry()

  // ---- Dependency tracking ----
  readonly _depIndex: DependencyIndex
  // Injected epic dependency graph, owned by EpicGroupService.
  readonly _epicIndex: EpicDepsReader

  // ---- Cross-cutting collaborators ----
  readonly _metrics: MetricsCollector
  readonly _circuitBreaker: CircuitBreaker
  readonly _wipTracker: WipTracker
  readonly _errorRegistry: ErrorRegistry
  private readonly terminalGuard = new TerminalGuard()
  // Set by onOAuthRefreshStart when message-consumer detects an auth error and
  // fires refreshOAuthTokenFromKeychain. Cleared in .finally(). Drain loop
  // awaits this before each spawn (awaitOAuthRefresh) so new agents don't start
  // with the same stale token that caused the auth error.
  private _oauthRefreshPromise: Promise<unknown> | null = null

  // ---- Timers ----
  private readonly lifecycle = new LifecycleController()

  // ---- Injected deps ----
  private readonly runAgentDeps: RunAgentDeps
  private readonly unitOfWork: IUnitOfWork
  private readonly _taskStateService: TaskStateService
  /** Optional external hook that replaces the default dep-resolution path when set. */
  private readonly _terminalResolution: TerminalResolutionStrategy | undefined

  // `config` is mutable so `reloadConfig()` can hot-update runtime-safe fields.
  // `worktreeBase` is never mutated after construction.
  config: AgentManagerConfig

  constructor(
    config: AgentManagerConfig,
    readonly repo: IAgentTaskRepository,
    readonly logger: Logger = defaultLogger,
    epicDepsReader: EpicDepsReader = createEpicDependencyIndex(),
    unitOfWork: IUnitOfWork = createUnitOfWork(),
    terminalResolution?: TerminalResolutionStrategy
  ) {
    this.config = config
    this._terminalResolution = terminalResolution
    this._depIndex = createDependencyIndex()
    this._epicIndex = epicDepsReader
    this._metrics = createMetricsCollector()
    const circuitObserver: CircuitObserver = {
      onCircuitOpen: (payload) => broadcast('agent-manager:circuit-breaker-open', payload)
    }
    this._circuitBreaker = new CircuitBreaker(logger, circuitObserver)
    this._errorRegistry = new ErrorRegistry(logger)
    this._wipTracker = new WipTracker(() => this.spawnRegistry.activeAgentCount())
    this.unitOfWork = unitOfWork

    // Build the agent-manager TaskStateService.
    // The dispatcher delegates to this.onTaskTerminal which sets _depIndexDirty
    // and calls handleTaskTerminal — preserving the existing pipeline-agent
    // terminal semantics (metrics, dep resolution, dep-index rebuild).
    const agentTerminalDispatcher = {
      dispatch: (taskId: string, status: TaskStatus) => this.onTaskTerminal(taskId, status)
    }
    this._taskStateService = createTaskStateService({
      terminalDispatcher: agentTerminalDispatcher,
      logger
    })

    // Build runAgentDeps with bound onTaskTerminal and taskStateService
    this.runAgentDeps = {
      spawnRegistry: this.spawnRegistry,
      defaultModel: config.defaultModel,
      logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      repo,
      unitOfWork,
      metrics: this._metrics,
      taskStateService: this._taskStateService,
      worktreeBase: config.worktreeBase,
      onSpawnSuccess: () => {
        this._circuitBreaker.recordSuccess()
        this._errorRegistry.recordSpawnSuccess()
      },
      onSpawnFailure: (taskId: string, reason: string) => {
        this._circuitBreaker.recordFailure(taskId, reason)
        this._errorRegistry.recordSpawnFailure(taskId, reason)
      },
      onFastFailRecorded: (taskId: string, reason: string) => {
        this._errorRegistry.fastFailTracker.record(taskId, reason)
      },
      isFastFailExhausted: (taskId: string) => {
        return this._errorRegistry.fastFailTracker.isExhausted(taskId)
      },
      onOAuthRefreshStart: (promise: Promise<unknown>) => {
        this._oauthRefreshPromise = promise.finally(() => {
          this._oauthRefreshPromise = null
        })
      }
    }

    // Construct the DrainLoop after runAgentDeps is ready (processQueuedTask needs _spawnAgent).
    const drainLoopDeps: DrainLoopDeps = {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      metrics: this._metrics,
      logger,
      isShuttingDown: () => this._shuttingDown,
      isCircuitOpen: (now?: number) => this._circuitBreaker.isOpen(now),
      activeAgents: this.spawnRegistry.asActiveAgentsMap(),
      getPendingSpawns: () => this.spawnRegistry.pendingSpawnCount(),
      isDepIndexDirty: () => this._depIndexDirty,
      setDepIndexDirty: (dirty) => { this._depIndexDirty = dirty },
      processQueuedTask: (raw, map) => this._processQueuedTask(raw, map),
      onTaskTerminal: this.onTaskTerminal.bind(this),
      taskStateService: this._taskStateService,
      emitDrainPaused: (event) => broadcast('agentManager:drainPaused', event),
      awaitOAuthRefresh: () => this.awaitOAuthRefresh()
    }
    this._drainLoopInstance = new DrainLoop(drainLoopDeps, makeConcurrencyState(config.maxConcurrent))
  }

  // ---- Test seam ----

  /**
   * Stable typed view of the underscore-prefixed members tests reach into.
   * Construct lazily and cache so repeat access returns the same view.
   *
   * Tests should access internals via `mgr.__testInternals.<name>` rather
   * than `mgr._<name>` so future field renames touch only the seam mapping
   * in `agent-manager-test-internals.ts`, not 35+ test sites.
   */
  private _testInternalsView?: AgentManagerTestInternals
  get __testInternals(): AgentManagerTestInternals {
    return (this._testInternalsView ??= new AgentManagerTestInternals(this))
  }

  // ---- Helpers ----

  /**
   * Incrementally refresh the dependency index from the repository.
   * Delegates to the pure `refreshDependencyIndex` function.
   *
   * Returns a Map<taskId, status> built from the current task list.
   * On repo error, logs a warning and returns an empty map so the drain loop
   * continues with a stale-but-safe state.
   *
   * Exposed to tests via `__testInternals.refreshDependencyIndex()`.
   */
  _refreshDependencyIndex(): Map<string, TaskStatus> {
    // Delegate to the DrainLoop's dep-status map builder, which manages the
    // lastTaskDeps fingerprint cache internally.
    return this._drainLoopInstance.buildTaskStatusMap()
  }

  async onTaskTerminal(taskId: string, status: TaskStatus): Promise<void> {
    // Mark dirty synchronously so any concurrent drain tick that fires while
    // handleTaskTerminal is awaited will see the flag and do a full rebuild,
    // rather than reading a stale dependency index.
    this._depIndexDirty = true
    return this.terminalGuard.guardedCall(taskId, () =>
      handleTaskTerminal(taskId, status, this.onTaskTerminal.bind(this), {
        metrics: this._metrics,
        depIndex: this._depIndex,
        epicIndex: this._epicIndex,
        repo: this.repo,
        unitOfWork: this.unitOfWork,
        config: this.config,
        ...(this._terminalResolution && { terminalResolution: this._terminalResolution }),
        terminalCalled: new Map(), // TerminalGuard owns outer dedup; fresh Map per call is safe
        logger: this.logger
      })
    )
  }

  /**
   * Fire-and-forget agent spawn — errors logged inside runAgent.
   *
   * _pendingSpawns is always decremented in finally, regardless of whether
   * the error occurred before, during, or after the actual spawn call.
   * This prevents the concurrency counter from leaking when runAgent throws
   * early (e.g. validation failure before spawnAndWireAgent is reached).
   */
  _spawnAgent(
    task: AgentRunClaim,
    worktree: { worktreePath: string; branch: string },
    repoPath: string,
    tickId?: string
  ): Promise<void> {
    const { decrementPendingOnce } = this.incrementSpawnAccounting()

    // Track whether the spawn phase reported an outcome via its callbacks so the
    // catch below can distinguish "spawn never attempted" (unexpected early error)
    // from "spawn failed and onSpawnFailure already counted it" vs "spawn
    // succeeded but something broke after" — only the first case should trip the
    // circuit breaker from this catch site.
    let spawnPhaseReported = false
    const spawnDeps: typeof this.runAgentDeps = {
      ...this.runAgentDeps,
      onAgentRegistered: decrementPendingOnce,
      tickId,
      onSpawnSuccess: () => {
        spawnPhaseReported = true
        this.runAgentDeps.onSpawnSuccess?.()
      },
      onSpawnFailure: (taskId: string, reason: string) => {
        spawnPhaseReported = true
        this.runAgentDeps.onSpawnFailure?.(taskId, reason)
      }
    }
    const agentPromise = _runAgent(task, worktree, repoPath, spawnDeps)
      .catch((err) => {
        this.logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
        this.recordCircuitBreakerFailure(task.id, err, spawnPhaseReported)
        this.releaseClaimAsLastResort(task.id, err)
      })
      .finally(() => {
        decrementPendingOnce() // no-op if onAgentRegistered already fired
        this.spawnRegistry.forgetPromise(agentPromise)
      })
    this.spawnRegistry.trackPromise(agentPromise)
    return Promise.resolve()
  }

  /**
   * Increments spawn metrics and the pending-spawn counter.
   * Returns a guard that decrements pending-spawns exactly once, used either
   * when the agent registers (onAgentRegistered) or when the spawn errors early.
   */
  private incrementSpawnAccounting(): { decrementPendingOnce: () => void } {
    this._metrics.increment('agentsSpawned')
    this.spawnRegistry.incrementPendingSpawns()

    let decremented = false
    const decrementPendingOnce = (): void => {
      if (!decremented) {
        decremented = true
        this.spawnRegistry.decrementPendingSpawns()
      }
    }
    return { decrementPendingOnce }
  }

  /**
   * Trips the circuit breaker only when the spawn phase never reported an
   * outcome — meaning an unexpected error fired before spawnAndWireAgent
   * could call onSpawnSuccess or onSpawnFailure.
   */
  private recordCircuitBreakerFailure(
    taskId: string,
    err: unknown,
    spawnPhaseReported: boolean
  ): void {
    if (!spawnPhaseReported) {
      this._circuitBreaker.recordFailure(taskId, String(err))
    }
  }

  /**
   * Last-resort claim release — attempts to write status='error', falls back
   * to a claimed_by=null-only patch if the status write is rejected.
   * Mirrors the phase-a-bypass pattern; see T-36 for the full fix path.
   */
  private releaseClaimAsLastResort(taskId: string, err: unknown): void {
    const errorNotes = String(err)
    try {
      this.repo.updateTask(taskId, { status: 'error', claimed_by: null, notes: errorNotes }) // phase-a-bypass: T-36
    } catch (statusWriteErr) {
      // The transition guard rejected the status write (e.g. another path already moved the
      // task to a terminal state). Fall back to a claim-only patch so `claimed_by` is always
      // cleared even when the status field cannot be written.
      this.logger.warn(
        `[agent-manager] Status write rejected for task ${taskId} — retrying with claim-only patch: ${statusWriteErr}`
      )
      try {
        this.repo.updateTask(taskId, { claimed_by: null, notes: errorNotes })
      } catch (claimReleaseErr) {
        this.logger.error(
          `[agent-manager] Failed to release claim for task ${taskId}: ${claimReleaseErr}`
        )
      }
    }
  }

  // ---- Task processing delegates ----

  /**
   * Validate and claim a task. Delegates to task-claimer.ts.
   * Exposed to tests via `__testInternals`.
   */
  async _validateAndClaimTask(
    rawTask: SprintTask,
    taskStatusMap: Map<string, TaskStatus>
  ): Promise<{ task: MappedTask; repoPath: string } | null> {
    return validateAndClaimTask(rawTask, taskStatusMap, {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      logger: this.logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      taskStateService: this._taskStateService
    })
  }

  /**
   * Prepare the git worktree for a task. Delegates to task-claimer.ts.
   * Exposed to tests via `__testInternals`.
   */
  async _prepareWorktreeForTask(
    task: MappedTask,
    repoPath: string
  ): Promise<{ worktreePath: string; branch: string } | null> {
    return prepareWorktreeForTask(task, repoPath, {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      logger: this.logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      taskStateService: this._taskStateService
    })
  }

  /**
   * Full pipeline for one queued task row. Delegates to task-claimer.ts.
   * Exposed to tests via `__testInternals`.
   */
  async _processQueuedTask(
    rawTask: SprintTask,
    taskStatusMap: Map<string, TaskStatus>,
    tickId?: string
  ): Promise<void> {
    return processQueuedTask(rawTask, taskStatusMap, {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      logger: this.logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      taskStateService: this._taskStateService,
      spawnRegistry: this.spawnRegistry,
      spawnAgent: (task, wt, repoPath) => this._spawnAgent(task, wt, repoPath, tickId),
      recentlyProcessedTaskIds: this._drainLoopInstance.recentlyProcessedTaskIds
    })
  }

  // ---- Drain loop delegates ----

  /**
   * Fetch queued tasks and process each one. Delegates to drain-loop.ts.
   * Exposed to tests via `__testInternals`.
   */
  async _drainQueuedTasks(available: number, taskStatusMap: Map<string, TaskStatus>): Promise<void> {
    const queued = this.repo.getQueuedTasks(available)
    for (const rawTask of queued) {
      if (this._shuttingDown) break
      if (availableSlots(this._concurrency, this.spawnRegistry.activeAgentCount() + this.spawnRegistry.pendingSpawnCount()) <= 0) {
        this.logger.info('[agent-manager] No slots available — stopping drain iteration')
        break
      }
      try {
        await this._processQueuedTask(rawTask, taskStatusMap)
      } catch (err) {
        this.logger.error(`[agent-manager] Failed to process task ${rawTask.id}: ${err}`)
      }
    }
  }

  /**
   * Execute one full drain tick. Delegates to the DrainLoop instance.
   * Exposed via _ prefix for testability.
   */
  async _drainLoop(): Promise<void> {
    return this._drainLoopInstance.runDrain()
  }

  // ---- Watchdog delegates ----

  /**
   * Execute one watchdog tick. Delegates to watchdog-loop.ts.
   * Exposed to tests via `__testInternals`.
   */
  async _watchdogLoop(): Promise<void> {
    const watchdogDeps: WatchdogLoopDeps = {
      config: this.config,
      repo: this.repo,
      metrics: this._metrics,
      logger: this.logger,
      spawnRegistry: this.spawnRegistry,
      getConcurrency: () => this._drainLoopInstance.getConcurrency(),
      setConcurrency: (state) => {
        this._drainLoopInstance.setConcurrency(state)
      },
      onTaskTerminal: this.onTaskTerminal.bind(this),
      taskStateService: this._taskStateService,
      cleanupAgentWorktree: async (agent) => {
        const task = this.repo.getTask(agent.taskId)
        const repoPath = task ? resolveRepoPath(task.repo) : null
        if (!repoPath) return
        await cleanupWorktree({
          repoPath,
          worktreePath: agent.worktreePath,
          branch: agent.branch,
          logger: this.logger
        })
      },
      broadcastToRenderer: (channel, payload) => broadcast(channel as 'manager:warning', payload as { message: string })
    }
    await runWatchdog(watchdogDeps)
  }

  // ---- Orphan loop ----

  private async _orphanLoop(): Promise<void> {
    try {
      const result = await recoverOrphans(
        (id: string) => this.spawnRegistry.hasActiveAgent(id),
        this.repo,
        this.logger,
        this._taskStateService
      )
      this._broadcastOrphanResultIfNonEmpty(result)
    } catch (err) {
      this.logger.error(`[agent-manager] Orphan recovery error: ${err}`)
    }
  }

  // ---- Prune loop delegate ----

  private async _pruneLoop(): Promise<void> {
    try {
      await runPruneLoop({
        worktreeBase: this.config.worktreeBase,
        repo: this.repo,
        logger: this.logger,
        isActiveAgent: (id) => this.spawnRegistry.hasActiveAgent(id),
        isReviewTask: (id) => checkIsReviewTask(id, this.repo)
      })
    } catch (err) {
      this.logger.error(`[agent-manager] Worktree prune error: ${err}`)
    }
  }

  // ---- Orphan broadcast helper ----

  private _broadcastOrphanResultIfNonEmpty(result: {
    recovered: string[]
    exhausted: string[]
  }): void {
    if (result.recovered.length > 0 || result.exhausted.length > 0) {
      broadcast('orphan:recovered', result)
    }
  }

  // ---- Public methods ----

  start(): void {
    if (this._started) {
      this.logger.warn('[agent-manager] start() called while already running — ignoring duplicate call')
      return
    }
    this._started = true
    this._running = true
    this._shuttingDown = false
    this._concurrency = makeConcurrencyState(this.config.maxConcurrent)
    this.clearStaleClaims()
    this.initDependencyIndex()
    this.kickOffInitialWorktreePrune()
    this.lifecycle.startTimers(
      this.config.pollIntervalMs,
      {
        onDrainTick: () => this.tickDrain(),
        onWatchdogTick: () => {
          this._watchdogLoop().catch((err) =>
            this.logger.warn(`[agent-manager] Watchdog loop error: ${err}`)
          )
        },
        onOrphanTick: () => {
          this._orphanLoop().catch((err) =>
            this.logger.warn(`[agent-manager] Orphan loop error: ${err}`)
          )
        },
        onPruneTick: () => {
          this._pruneLoop().catch((err) =>
            this.logger.warn(`[agent-manager] Prune loop error: ${err}`)
          )
        }
      },
      // Stagger the four loop timers so they don't all fire at t=0.
      // Drain starts first (no delay); watchdog/orphan/prune spread across 250ms.
      {
        drainInitialDelayMs: 0,
        watchdogInitialDelayMs: 100,
        orphanInitialDelayMs: 175,
        pruneInitialDelayMs: 250
      }
    )
    this._scheduleInitialDrain()

    this.logger.info('[agent-manager] Started')
  }

  // Startup sweep: clear stale claimed_by from the previous process session.
  // Orphan recovery only re-queues active tasks — this sweep handles all other
  // statuses so no task is claimed-forever after a restart.
  private clearStaleClaims(): void {
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
  }

  // The epic graph is owned by EpicGroupService — this.repo does not rebuild it.
  private initDependencyIndex(): void {
    try {
      const tasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(tasks)
      this._drainLoopInstance.initializeFingerprintsFrom(tasks)
      this.logger.info(`[agent-manager] Dependency index built with ${tasks.length} tasks`)
    } catch (err) {
      this.logger.error(`[agent-manager] Failed to build dependency index: ${err}`)
    }
  }

  // Initial worktree prune (fire-and-forget) — called directly so the caller
  // can attach the "Initial worktree prune error" message; the periodic
  // _pruneLoop() uses a separate message.
  private kickOffInitialWorktreePrune(): void {
    pruneStaleWorktrees(
      this.config.worktreeBase,
      (id: string) => this.spawnRegistry.hasActiveAgent(id),
      this.logger,
      (id: string) => checkIsReviewTask(id, this.repo)
    ).catch((err) => {
      this.logger.error(`[agent-manager] Initial worktree prune error: ${err}`)
    })
  }

  private tickDrain(): void {
    if (this._drainInFlight) return
    this._drainInFlight = this._drainLoop()
      .then(() => {
        this._consecutiveDrainErrors = 0
      })
      .catch((err) => this.recordDrainTickError(err))
      .finally(() => {
        this._drainInFlight = null
      })
  }

  private recordDrainTickError(err: unknown): void {
    this._consecutiveDrainErrors++
    this.logger.warn(`[agent-manager] Drain loop error (${this._consecutiveDrainErrors}): ${err}`)
    if (this._consecutiveDrainErrors >= 3) {
      broadcast('manager:warning', {
        message:
          'Agent queue is not processing — check logs for details. Drain errors: ' +
          this._consecutiveDrainErrors
      })
    }
  }

  // Defer the first drain so the event loop settles and orphan recovery can complete
  // before any queued task is claimed.
  private _scheduleInitialDrain(): void {
    setTimeout(() => {
      this._drainInFlight = (async () => {
        try {
          const result = await recoverOrphans(
            (id: string) => this.spawnRegistry.hasActiveAgent(id),
            this.repo,
            this.logger,
            this._taskStateService
          )
          this._broadcastOrphanResultIfNonEmpty(result)
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
  }

  /**
   * Polls until all active agents have reached a terminal or review state, or
   * `gracePeriodMs` elapses — whichever comes first.
   *
   * Intentionally separate from `stop()` so callers can choose how long to
   * wait before forcing a re-queue of remaining active tasks.
   */
  async waitForAgentsToSettle(gracePeriodMs: number): Promise<void> {
    const deadline = Date.now() + gracePeriodMs
    while (this.spawnRegistry.activeAgentCount() > 0 && Date.now() < deadline) {
      await sleep(100)
    }
  }

  // finalizeAgentRun includes git rebase + PR creation which can take 30+ seconds
  async stop(timeoutMs = 60_000): Promise<void> {
    this._shuttingDown = true
    this.lifecycle.stopTimers()

    await executeShutdown(
      {
        repo: this.repo,
        logger: this.logger,
        spawnRegistry: this.spawnRegistry,
        drainInFlight: this._drainInFlight
      },
      timeoutMs
    )
    this._drainInFlight = null

    this._started = false
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
      concurrency: { ...this._concurrency, activeCount: this.spawnRegistry.activeAgentCount() },
      activeAgents: [...this.spawnRegistry.allAgents()].map((a) => ({
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

    const agent = this.spawnRegistry.getAgent(taskId)
    if (!agent) return { delivered: false, error: 'Agent not found' }
    return agent.handle.steer(message)
  }

  reloadConfig(): { updated: string[]; requiresRestart: string[] } {
    return reloadConfiguration({
      config: this.config,
      concurrency: this._concurrency,
      runAgentDeps: this.runAgentDeps,
      logger: this.logger
    })
  }

  killAgent(taskId: string): { killed: boolean; error?: string } {
    const agent = this.spawnRegistry.getAgent(taskId)
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

  async cancelAgent(taskId: string): Promise<void> {
    const result = this.killAgent(taskId)
    if (!result.killed) {
      this.logger.warn(`[agent-manager] cancelAgent(${taskId}): ${result.error ?? 'agent not found'}`)
    }
  }

  awaitOAuthRefresh(): Promise<void> {
    if (!this._oauthRefreshPromise) return Promise.resolve()
    return this._oauthRefreshPromise.then(
      () => {},
      () => {}
    )
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentManager(
  config: AgentManagerConfig,
  repo: IAgentTaskRepository,
  logger: Logger = defaultLogger,
  epicDepsReader?: EpicDepsReader,
  unitOfWork?: IUnitOfWork,
  terminalResolution?: TerminalResolutionStrategy
): AgentManager {
  return new AgentManagerImpl(config, repo, logger, epicDepsReader, unitOfWork, terminalResolution)
}

// Re-export killActiveAgent for callers that need to kill agents directly
export { killActiveAgent }
