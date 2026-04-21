import type { AgentManagerConfig, ActiveAgent, SteerResult } from './types'
import type { Logger } from '../logger'
import type { TaskDependency } from '../../shared/types'
import type { SprintTask } from '../../shared/types/task-types'
import { computeDepsFingerprint, refreshDependencyIndex } from './dependency-refresher'
import { handleTaskTerminal } from './terminal-handler'
import {
  EXECUTOR_ID,
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
  INITIAL_DRAIN_DEFER_MS
} from './types'
import { makeConcurrencyState, availableSlots, type ConcurrencyState } from './concurrency'
import { recoverOrphans } from './orphan-recovery'
import { createDependencyIndex } from '../services/dependency-service'
import { createEpicDependencyIndex, type EpicDepsReader } from '../services/epic-dependency-service'
import { runAgent as _runAgent, type RunAgentDeps, type AgentRunClaim } from './run-agent'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
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

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to createLogger
// ---------------------------------------------------------------------------

import { createLogger } from '../logger'
import { broadcast } from '../broadcast'

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
  // Exposed state (testable via _ prefix)
  _concurrency: ConcurrencyState
  readonly _activeAgents = new Map<string, ActiveAgent>()
  readonly _processingTasks = new Set<string>()
  _running = false
  _shuttingDown = false
  _drainInFlight: Promise<void> | null = null
  readonly _agentPromises = new Set<Promise<void>>()
  readonly _depIndex: DependencyIndex
  /** Injected epic dependency graph, owned by EpicGroupService. */
  readonly _epicIndex: EpicDepsReader
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

  // Counts agents that have been fired via _spawnAgent but have not yet called
  // initializeAgentTracking (i.e. not yet in _activeAgents). Used by the drain
  // loop to prevent over-claiming slots during the async spawn window.
  _pendingSpawns = 0

  // Tracks consecutive drain-loop processing failures per task. Passed to DrainLoopDeps
  // each tick so counts persist across ticks. Cleared on success or quarantine.
  readonly _drainFailureCounts = new Map<string, number>()

  // Unix-ms until which the drain loop should skip its tick. Set when the
  // drain catches an environmental failure (main-repo dirty, auth missing,
  // network). Task 5 broadcasts the pause to the renderer.
  _drainPausedUntil: number | undefined

  // Tracks consecutive drain-tick-level errors (the drain loop itself threw).
  // Reset on any successful tick. Emits manager:warning after 3 consecutive failures.
  _consecutiveDrainErrors = 0

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
    readonly repo: IAgentTaskRepository,
    readonly logger: Logger = defaultLogger,
    epicDepsReader: EpicDepsReader = createEpicDependencyIndex()
  ) {
    this.config = config
    this._concurrency = makeConcurrencyState(config.maxConcurrent)
    this._depIndex = createDependencyIndex()
    this._epicIndex = epicDepsReader
    this._metrics = createMetricsCollector()
    this._circuitBreaker = new CircuitBreaker(logger)

    // Build runAgentDeps with bound onTaskTerminal
    this.runAgentDeps = {
      activeAgents: this._activeAgents,
      defaultModel: config.defaultModel,
      logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      repo,
      worktreeBase: config.worktreeBase,
      onSpawnSuccess: () => {
        this._circuitBreaker.recordSuccess()
      },
      onSpawnFailure: () => {
        this._circuitBreaker.recordFailure()
      }
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
    // Mark dirty synchronously so any concurrent drain tick that fires while
    // handleTaskTerminal is awaited will see the flag and do a full rebuild,
    // rather than reading a stale dependency index.
    this._depIndexDirty = true
    await handleTaskTerminal(taskId, status, this.onTaskTerminal.bind(this), {
      metrics: this._metrics,
      depIndex: this._depIndex,
      epicIndex: this._epicIndex,
      repo: this.repo,
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
    repoPath: string
  ): Promise<void> {
    this._metrics.increment('agentsSpawned')
    this._pendingSpawns++
    const agentPromise = _runAgent(task, worktree, repoPath, this.runAgentDeps)
      .catch((err) => {
        this.logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
        // Record the failure so the circuit breaker can open after repeated crashes.
        // handleSpawnFailure calls onSpawnFailure() when spawnWithTimeout throws, but
        // if runAgent throws before or after spawnAndWireAgent (e.g. unexpected error),
        // the circuit breaker would never see the failure without this guard.
        this._circuitBreaker.recordFailure()
        // Release the claim so the task does not remain stuck 'active'.
        // validateTaskForRun and handleSpawnFailure already do this on their
        // own code paths — this catch handles any remaining gap (e.g. an
        // unexpected throw before either of those paths is reached).
        try {
          this.repo.updateTask(task.id, { status: 'error', claimed_by: null, notes: String(err) })
        } catch (updateErr) {
          this.logger.error(
            `[agent-manager] Failed to release claim for task ${task.id}: ${updateErr}`
          )
        }
      })
      .finally(() => {
        this._pendingSpawns = Math.max(0, this._pendingSpawns - 1)
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
  async _processQueuedTask(rawTask: SprintTask, taskStatusMap: Map<string, string>): Promise<void> {
    return processQueuedTask(rawTask, taskStatusMap, {
      config: this.config,
      repo: this.repo,
      depIndex: this._depIndex,
      logger: this.logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      processingTasks: this._processingTasks,
      activeAgents: this._activeAgents,
      spawnAgent: this._spawnAgent.bind(this)
    })
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

  // ---- Drain loop delegates ----

  /**
   * Fetch queued tasks and process each one. Delegates to drain-loop.ts.
   * Exposed via _ prefix for testability.
   */
  async _drainQueuedTasks(available: number, taskStatusMap: Map<string, string>): Promise<void> {
    const queued = this.repo.getQueuedTasks(available)
    this.logger.info(`[agent-manager] Fetching queued tasks (limit=${available})...`)
    this.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
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
      processQueuedTask: (raw, map) => this._processQueuedTask(raw, map),
      drainFailureCounts: this._drainFailureCounts,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      drainPausedUntil: this._drainPausedUntil,
      emitDrainPaused: (event) => {
        this._drainPausedUntil = event.pausedUntil
        broadcast('agentManager:drainPaused', event)
      }
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
      await recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger)
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

    // Build dependency index and initialize dependency tracking.
    // The epic graph is owned by EpicGroupService — this.repo does not rebuild it.
    try {
      const tasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(tasks)
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

    // Initial worktree prune (fire-and-forget) — called directly so the caller
    // can attach the "Initial worktree prune error" message; the periodic
    // _pruneLoop() uses a separate message.
    pruneStaleWorktrees(
      this.config.worktreeBase,
      (id: string) => this._activeAgents.has(id),
      this.logger,
      (id: string) => checkIsReviewTask(id, this.repo)
    ).catch((err) => {
      this.logger.error(`[agent-manager] Initial worktree prune error: ${err}`)
    })

    // Start periodic loops
    this.pollTimer = setInterval(() => {
      if (this._drainInFlight) return // skip if previous drain still running
      this._drainInFlight = this._drainLoop()
        .then(() => {
          this._consecutiveDrainErrors = 0
        })
        .catch((err) => {
          this._consecutiveDrainErrors++
          this.logger.warn(
            `[agent-manager] Drain loop error (${this._consecutiveDrainErrors}): ${err}`
          )
          if (this._consecutiveDrainErrors >= 3) {
            broadcast('manager:warning', {
              message:
                'Agent queue is not processing — check logs for details. Drain errors: ' +
                this._consecutiveDrainErrors
            })
          }
        })
        .finally(() => {
          this._drainInFlight = null
        })
    }, this.config.pollIntervalMs)
    this.watchdogTimer = setInterval(() => {
      this._watchdogLoop().catch((err) =>
        this.logger.warn(`[agent-manager] Watchdog loop error: ${err}`)
      )
    }, WATCHDOG_INTERVAL_MS)
    this.orphanTimer = setInterval(() => {
      this._orphanLoop().catch((err) =>
        this.logger.warn(`[agent-manager] Orphan loop error: ${err}`)
      )
    }, ORPHAN_CHECK_INTERVAL_MS)
    this.pruneTimer = setInterval(() => {
      this._pruneLoop().catch((err) => this.logger.warn(`[agent-manager] Prune loop error: ${err}`))
    }, WORKTREE_PRUNE_INTERVAL_MS)

    this._scheduleInitialDrain()

    this.logger.info('[agent-manager] Started')
  }

  // Defer the first drain so the event loop settles and orphan recovery can complete
  // before any queued task is claimed.
  private _scheduleInitialDrain(): void {
    setTimeout(() => {
      this._drainInFlight = (async () => {
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
  epicDepsReader?: EpicDepsReader
): AgentManager {
  return new AgentManagerImpl(config, repo, logger, epicDepsReader)
}

// Re-export killActiveAgent for callers that need to kill agents directly
export { killActiveAgent }
