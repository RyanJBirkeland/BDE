import type { AgentManagerConfig, ActiveAgent, SteerResult } from './types'
import type { Logger } from '../logger'
import type { TaskDependency } from '../../shared/types'
import type { SprintTask } from '../../shared/types/task-types'
import type { TaskStatus } from '../../shared/task-state-machine'
import { computeDepsFingerprint, refreshDependencyIndex } from './dependency-refresher'
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
import { CircuitBreaker } from './circuit-breaker'

import type { MappedTask } from './task-mapper'

// Extracted module imports
import { runDrain, type DrainLoopDeps } from './drain-loop'
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

export class AgentManagerImpl implements AgentManager {
  // ---- Lifecycle flags ----
  // Fields prefixed with `_` are exposed for tests (private by convention,
  // not keyword). Real privacy will land in T-2 once the class split removes
  // the test-access need.
  _running = false
  _shuttingDown = false
  /**
   * Guards against duplicate `start()` calls. A second call while the manager
   * is already started logs a WARN and returns immediately — no new timers are
   * created and no startup side-effects are repeated.
   */
  _started = false

  // ---- Drain runtime ----
  _concurrency: ConcurrencyState
  _drainInFlight: Promise<void> | null = null
  // F-t1-sysprof-1/-4: cache deps fingerprint so subsequent drain ticks can
  // short-circuit the deep compare via hash equality.
  _lastTaskDeps = new Map<string, { deps: TaskDependency[] | null; hash: string }>()
  // Set when a terminal event fires; next drain tick rebuilds the dep index
  // fully instead of doing an incremental refresh.
  _depIndexDirty = false
  // IDs of tasks claimed in the most recent drain tick. Consumed (and cleared)
  // by the next tick's `refreshDependencyIndex` call as a dirty-set hint so
  // unchanged tasks skip fingerprint recompute.
  _recentlyProcessedTaskIds = new Set<string>()
  // Suspends drain ticks until this Unix-ms timestamp; broadcasts the pause
  // to the renderer when the drain catches an environmental failure.
  _drainPausedUntil: number | undefined
  // Per-task processing-failure counts that persist across drain ticks; cleared
  // on success or quarantine. Accessor to _errorRegistry.drainFailureCounts —
  // kept for backward compat with DrainLoopDeps (which expects a Map reference).
  get _drainFailureCounts(): Map<string, number> {
    return this._errorRegistry.drainFailureCounts
  }
  // Drain-tick-level error counter. Reset on any successful tick. Emits
  // `manager:warning` after 3 consecutive failures.
  _consecutiveDrainErrors = 0

  // ---- Spawn tracking ----
  readonly _activeAgents = new Map<string, ActiveAgent>()
  readonly _processingTasks = new Set<string>()
  readonly _agentPromises = new Set<Promise<void>>()
  // Counts agents fired via _spawnAgent but not yet present in _activeAgents.
  // Drain loop reads this to avoid over-claiming slots during the async spawn
  // window.
  _pendingSpawns = 0

  // ---- Dependency tracking ----
  readonly _depIndex: DependencyIndex
  // Injected epic dependency graph, owned by EpicGroupService.
  readonly _epicIndex: EpicDepsReader

  // ---- Cross-cutting collaborators ----
  readonly _metrics: MetricsCollector
  readonly _circuitBreaker: CircuitBreaker
  readonly _wipTracker: WipTracker
  readonly _errorRegistry: ErrorRegistry
  // Idempotency guard for handleTaskTerminal — maps taskId to the in-flight
  // terminal promise. Duplicate callers receive the same promise; the entry is
  // deleted in finally.
  private readonly _terminalCalled = new Map<string, Promise<void>>()

  // ---- Timers ----
  private readonly lifecycle = new LifecycleController()

  // ---- Injected deps ----
  private readonly runAgentDeps: RunAgentDeps
  private readonly unitOfWork: IUnitOfWork
  private readonly _taskStateService: TaskStateService

  // `config` is mutable so `reloadConfig()` can hot-update runtime-safe fields.
  // `worktreeBase` is never mutated after construction.
  config: AgentManagerConfig

  constructor(
    config: AgentManagerConfig,
    readonly repo: IAgentTaskRepository,
    readonly logger: Logger = defaultLogger,
    epicDepsReader: EpicDepsReader = createEpicDependencyIndex(),
    unitOfWork: IUnitOfWork = createUnitOfWork()
  ) {
    this.config = config
    this._concurrency = makeConcurrencyState(config.maxConcurrent)
    this._depIndex = createDependencyIndex()
    this._epicIndex = epicDepsReader
    this._metrics = createMetricsCollector()
    this._circuitBreaker = new CircuitBreaker(logger)
    this._errorRegistry = new ErrorRegistry(logger)
    this._wipTracker = new WipTracker(() => this._activeAgents.size)
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
      activeAgents: this._activeAgents,
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
      }
    }
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
   * Exposed via _ prefix convention (not private keyword) for testability.
   */
  _refreshDependencyIndex(): Map<string, string> {
    return refreshDependencyIndex(this._depIndex, this._lastTaskDeps, this.repo, this.logger)
  }

  async onTaskTerminal(taskId: string, status: TaskStatus): Promise<void> {
    // Mark dirty synchronously so any concurrent drain tick that fires while
    // handleTaskTerminal is awaited will see the flag and do a full rebuild,
    // rather than reading a stale dependency index.
    this._depIndexDirty = true
    await handleTaskTerminal(taskId, status, this.onTaskTerminal.bind(this), {
      metrics: this._metrics,
      depIndex: this._depIndex,
      epicIndex: this._epicIndex,
      repo: this.repo,
      unitOfWork: this.unitOfWork,
      config: this.config,
      terminalCalled: this._terminalCalled,
      logger: this.logger
    })
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
    this._metrics.increment('agentsSpawned')
    this._pendingSpawns++
    // Decrement exactly once: when the agent enters activeAgents (onAgentRegistered),
    // or on early failure before registration (decrementPendingOnce in .finally).
    let pendingDecremented = false
    const decrementPendingOnce = (): void => {
      if (!pendingDecremented) {
        pendingDecremented = true
        this._pendingSpawns = Math.max(0, this._pendingSpawns - 1)
      }
    }
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
        // Only increment the circuit breaker when the spawn phase never reported an
        // outcome — meaning an unexpected error fired before spawnAndWireAgent could
        // call onSpawnSuccess or onSpawnFailure. Stream errors and post-spawn
        // failures must NOT trip the circuit breaker (they indicate a task-level
        // issue, not a systemic spawn infrastructure failure).
        if (!spawnPhaseReported) {
          this._circuitBreaker.recordFailure(task.id, String(err))
        }
        // Release the claim so the task does not remain stuck 'active'.
        // validateTaskForRun and handleSpawnFailure already do this on their
        // own code paths — this catch handles any remaining gap (e.g. an
        // unexpected throw before either of those paths is reached).
        // EP-1 note: this is a last-resort safety net for unexpected errors before
        // or after spawnAndWireAgent — using repo.updateTask directly avoids a
        // circular-service dependency in the error path.
        try {
          this.repo.updateTask(task.id, { status: 'error', claimed_by: null, notes: String(err) })
        } catch (updateErr) {
          this.logger.error(
            `[agent-manager] Failed to release claim for task ${task.id}: ${updateErr}`
          )
        }
      })
      .finally(() => {
        decrementPendingOnce() // no-op if onAgentRegistered already fired
        this._agentPromises.delete(agentPromise)
      })
    this._agentPromises.add(agentPromise)
    return Promise.resolve()
  }

  // ---- Task processing delegates ----

  /**
   * Validate and claim a task. Delegates to task-claimer.ts.
   * Exposed via _ prefix for testability.
   */
  async _validateAndClaimTask(
    rawTask: SprintTask,
    taskStatusMap: Map<string, string>
  ): Promise<{ task: MappedTask; repoPath: string } | null> {
    return validateAndClaimTask(rawTask, taskStatusMap, {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      logger: this.logger,
      onTaskTerminal: this.onTaskTerminal.bind(this)
    })
  }

  /**
   * Prepare the git worktree for a task. Delegates to task-claimer.ts.
   * Exposed via _ prefix for testability.
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
      onTaskTerminal: this.onTaskTerminal.bind(this)
    })
  }

  /**
   * Full pipeline for one queued task row. Delegates to task-claimer.ts.
   * Exposed via _ prefix for testability.
   */
  async _processQueuedTask(
    rawTask: SprintTask,
    taskStatusMap: Map<string, string>,
    tickId?: string
  ): Promise<void> {
    return processQueuedTask(rawTask, taskStatusMap, {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      logger: this.logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      processingTasks: this._processingTasks,
      activeAgents: this._activeAgents,
      spawnAgent: (task, wt, repoPath) => this._spawnAgent(task, wt, repoPath, tickId),
      recentlyProcessedTaskIds: this._recentlyProcessedTaskIds
    })
  }

  // ---- Drain loop delegates ----

  /**
   * Fetch queued tasks and process each one. Delegates to drain-loop.ts.
   * Exposed via _ prefix for testability.
   */
  async _drainQueuedTasks(available: number, taskStatusMap: Map<string, string>): Promise<void> {
    const queued = this.repo.getQueuedTasks(available)
    for (const rawTask of queued) {
      if (this._shuttingDown) break
      if (availableSlots(this._concurrency, this._activeAgents.size + this._pendingSpawns) <= 0) {
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
   * Execute one full drain tick. Delegates to drain-loop.ts.
   * Exposed via _ prefix for testability.
   */
  async _drainLoop(): Promise<void> {
    // Capture circuit breaker state at drain start — the open timestamp only
    // changes when recordFailure() is called, which happens on spawn failures.
    // Reading it once here is safe for this drain tick's precondition log.
    const circuitBreaker = this._circuitBreaker
    const drainDeps: DrainLoopDeps = {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      metrics: this._metrics,
      logger: this.logger,
      isShuttingDown: () => this._shuttingDown,
      isCircuitOpen: (now?: number) => circuitBreaker.isOpen(now),
      circuitOpenUntil: circuitBreaker.openUntilTimestamp,
      activeAgents: this._activeAgents,
      getConcurrency: () => this._concurrency,
      getPendingSpawns: () => this._pendingSpawns,
      lastTaskDeps: this._lastTaskDeps,
      isDepIndexDirty: () => this._depIndexDirty,
      setDepIndexDirty: (dirty) => {
        this._depIndexDirty = dirty
      },
      setConcurrency: (state) => {
        this._concurrency = state
      },
      processQueuedTask: (raw, map) => this._processQueuedTask(raw, map, drainDeps.tickId),
      drainFailureCounts: this._drainFailureCounts,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      taskStateService: this._taskStateService,
      drainPausedUntil: this._drainPausedUntil,
      emitDrainPaused: (event) => {
        this._drainPausedUntil = event.pausedUntil
        broadcast('agentManager:drainPaused', event)
      },
      recentlyProcessedTaskIds: this._recentlyProcessedTaskIds
    }
    return runDrain(drainDeps)
  }

  // ---- Watchdog delegates ----

  /**
   * Execute one watchdog tick. Delegates to watchdog-loop.ts.
   * Exposed via _ prefix for testability.
   */
  async _watchdogLoop(): Promise<void> {
    const watchdogDeps: WatchdogLoopDeps = {
      config: this.config,
      repo: this.repo,
      metrics: this._metrics,
      logger: this.logger,
      activeAgents: this._activeAgents,
      processingTasks: this._processingTasks,
      getConcurrency: () => this._concurrency,
      setConcurrency: (state) => {
        this._concurrency = state
      },
      onTaskTerminal: this.onTaskTerminal.bind(this),
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
      }
    }
    await runWatchdog(watchdogDeps)
  }

  // ---- Orphan loop ----

  private async _orphanLoop(): Promise<void> {
    try {
      const result = await recoverOrphans(
        (id: string) => this._activeAgents.has(id),
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
        isActiveAgent: (id) => this._activeAgents.has(id),
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
    this.kickOffOrphanRecovery()
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

  private kickOffOrphanRecovery(): void {
    recoverOrphans(
      (id: string) => this._activeAgents.has(id),
      this.repo,
      this.logger,
      this._taskStateService
    )
      .then((result) => this._broadcastOrphanResultIfNonEmpty(result))
      .catch((err) => {
        this.logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
      })
  }

  // The epic graph is owned by EpicGroupService — this.repo does not rebuild it.
  private initDependencyIndex(): void {
    try {
      const tasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(tasks)
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
  }

  // Initial worktree prune (fire-and-forget) — called directly so the caller
  // can attach the "Initial worktree prune error" message; the periodic
  // _pruneLoop() uses a separate message.
  private kickOffInitialWorktreePrune(): void {
    pruneStaleWorktrees(
      this.config.worktreeBase,
      (id: string) => this._activeAgents.has(id),
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
            (id: string) => this._activeAgents.has(id),
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
    while (this._activeAgents.size > 0 && Date.now() < deadline) {
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
        activeAgents: this._activeAgents,
        agentPromises: this._agentPromises,
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
    return reloadConfiguration({
      config: this.config,
      concurrency: this._concurrency,
      runAgentDeps: this.runAgentDeps,
      logger: this.logger
    })
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
  repo: IAgentTaskRepository,
  logger: Logger = defaultLogger,
  epicDepsReader?: EpicDepsReader,
  unitOfWork?: IUnitOfWork
): AgentManager {
  return new AgentManagerImpl(config, repo, logger, epicDepsReader, unitOfWork)
}

// Re-export killActiveAgent for callers that need to kill agents directly
export { killActiveAgent }
