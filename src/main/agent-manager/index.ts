import type { AgentManagerConfig, ActiveAgent, SteerResult } from './types'
import type { Logger } from '../logger'
import {
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
  INITIAL_DRAIN_DEFER_MS
} from './types'
import { getErrorMessage } from '../../shared/errors'
import { makeConcurrencyState, setMaxSlots, type ConcurrencyState } from './concurrency'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { createMetricsCollector, type MetricsCollector, type MetricsSnapshot } from './metrics'
import { getSetting, getSettingJson } from '../settings'
import { flushAgentEventBatcher } from '../agent-event-mapper'
import { SPAWN_CIRCUIT_FAILURE_THRESHOLD, SPAWN_CIRCUIT_PAUSE_MS } from './circuit-breaker'
import {
  checkOAuthToken,
  invalidateCheckOAuthTokenCache,
  OAUTH_CHECK_CACHE_TTL_MS,
  OAUTH_CHECK_FAIL_CACHE_TTL_MS
} from './oauth-checker'
import { handleWatchdogVerdict, type WatchdogVerdictResult } from './watchdog-handler'
import type { WatchdogCheck, WatchdogAction } from './types'
import { resolveDependents } from './resolve-dependents'
import type { RunAgentDeps } from './run-agent'
import { createDependencyResolver, type DependencyResolver } from './dependency-resolver'
import { createAgentSupervisor, type AgentSupervisor } from './agent-supervisor'
import { createTaskScheduler, type TaskScheduler } from './task-scheduler'
import type { DependencyIndex } from '../services/dependency-service'
import type { EpicDependencyIndex } from '../services/epic-dependency-service'

// Re-export for backward compatibility with tests
export { SPAWN_CIRCUIT_FAILURE_THRESHOLD, SPAWN_CIRCUIT_PAUSE_MS }
export {
  checkOAuthToken,
  invalidateCheckOAuthTokenCache,
  OAUTH_CHECK_CACHE_TTL_MS,
  OAUTH_CHECK_FAIL_CACHE_TTL_MS
}
export { handleWatchdogVerdict }
export type { WatchdogVerdictResult, WatchdogCheck, WatchdogAction }

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
  reloadConfig(): {
    updated: string[]
    requiresRestart: string[]
  }
}

// ---------------------------------------------------------------------------
// Class implementation
// ---------------------------------------------------------------------------

export class AgentManagerImpl implements AgentManager {
  // Exposed state (testable via _ prefix)
  _concurrency: ConcurrencyState
  readonly _activeAgents = new Map<string, ActiveAgent>()
  readonly _processingTasks = new Set<string>()
  _running = false
  _shuttingDown = false
  _drainInFlight: Promise<void> | null = null
  readonly _agentPromises = new Set<Promise<void>>()
  readonly _metrics: MetricsCollector

  // F-t4-lifecycle-5: Idempotency guard to prevent double dependency resolution
  // when watchdog and completion handler race.
  private readonly _terminalCalled = new Set<string>()

  // Private timers
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private orphanTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  // Sub-systems
  private readonly dependencyResolver: DependencyResolver
  private readonly supervisor: AgentSupervisor
  private readonly scheduler: TaskScheduler

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
    this._metrics = createMetricsCollector()

    // Create sub-systems
    this.dependencyResolver = createDependencyResolver({
      repo,
      logger
    })

    this.supervisor = createAgentSupervisor({
      repo,
      config,
      metrics: this._metrics,
      logger
    })

    // Build runAgentDeps with bound onTaskTerminal
    this.runAgentDeps = {
      activeAgents: this._activeAgents,
      defaultModel: config.defaultModel,
      logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      repo,
      onSpawnSuccess: () => this.supervisor.circuitBreaker.recordSuccess(),
      onSpawnFailure: () => this.supervisor.circuitBreaker.recordFailure()
    }

    this.scheduler = createTaskScheduler({
      repo,
      config,
      runAgentDeps: this.runAgentDeps,
      dependencyResolver: this.dependencyResolver,
      supervisor: this.supervisor,
      metrics: this._metrics,
      logger
    })
  }

  /**
   * Backward compatibility accessors for tests that check dependency indexes.
   */
  get _depIndex(): DependencyIndex {
    return this.dependencyResolver.depIndex
  }

  get _epicIndex(): EpicDependencyIndex {
    return this.dependencyResolver.epicIndex
  }

  /**
   * Backward compatibility accessors for tests that check circuit breaker state.
   */
  get _consecutiveSpawnFailures(): number {
    return this.supervisor.circuitBreaker.failureCount
  }

  get _circuitOpenUntil(): number {
    return this.supervisor.circuitBreaker.openUntilTimestamp
  }

  /**
   * Backward compatibility — delegates to CircuitBreaker.recordSuccess().
   */
  _recordSpawnSuccess(): void {
    this.supervisor.circuitBreaker.recordSuccess()
  }

  /**
   * Backward compatibility — delegates to CircuitBreaker.recordFailure().
   */
  _recordSpawnFailure(): void {
    this.supervisor.circuitBreaker.recordFailure()
  }

  /**
   * Backward compatibility — delegates to CircuitBreaker.isOpen().
   */
  _isCircuitOpen(now?: number): boolean {
    return this.supervisor.circuitBreaker.isOpen(now)
  }

  /**
   * Backward compatibility — expose TaskScheduler for tests.
   */
  get _scheduler(): TaskScheduler {
    return this.scheduler
  }

  /**
   * Backward compatibility — expose AgentSupervisor for tests.
   */
  get _supervisor(): AgentSupervisor {
    return this.supervisor
  }

  /**
   * Backward compatibility — expose DependencyResolver for tests.
   */
  get _dependencyResolver(): DependencyResolver {
    return this.dependencyResolver
  }

  /**
   * Backward compatibility — delegates to scheduler.processQueuedTask().
   */
  async _processQueuedTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>
  ): Promise<void> {
    return this.scheduler.processQueuedTask(
      raw,
      taskStatusMap,
      this._processingTasks,
      this._agentPromises,
      this.onTaskTerminal.bind(this)
    )
  }

  /**
   * Backward compatibility — delegates to scheduler.mapQueuedTask().
   */
  _mapQueuedTask(raw: Record<string, unknown>) {
    return this.scheduler.mapQueuedTask(raw)
  }

  /**
   * Backward compatibility — delegates to scheduler.checkAndBlockDeps().
   */
  _checkAndBlockDeps(
    taskId: string,
    rawDeps: unknown,
    taskStatusMap: Map<string, string>
  ): boolean {
    return this.scheduler.checkAndBlockDeps(taskId, rawDeps, taskStatusMap)
  }

  /**
   * Backward compatibility — delegates to supervisor.runWatchdog().
   */
  async _watchdogLoop(): Promise<void> {
    const updatedConcurrency = await this.supervisor.runWatchdog(
      this._activeAgents,
      this._processingTasks,
      this._concurrency,
      this.onTaskTerminal.bind(this)
    )
    this._concurrency = updatedConcurrency
  }

  /**
   * Backward compatibility — delegates to dependencyResolver.updateIndexes().
   */
  get _lastTaskDeps() {
    // Tests access this directly, but it's now private in DependencyResolverImpl.
    // Return a proxy that delegates to the implementation.
    return (this.dependencyResolver as any).lastTaskDeps
  }

  /**
   * Backward compatibility — delegates to scheduler.runDrain().
   */
  async _drainLoop(): Promise<void> {
    const updatedConcurrency = await this.scheduler.runDrain(
      this._shuttingDown,
      this._activeAgents,
      this._processingTasks,
      this._agentPromises,
      this._concurrency,
      this.onTaskTerminal.bind(this)
    )
    this._concurrency = updatedConcurrency
  }

  async onTaskTerminal(taskId: string, status: string): Promise<void> {
    // F-t4-lifecycle-5: Guard against double-invocation when watchdog and completion handler race
    if (this._terminalCalled.has(taskId)) {
      this.logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
      return
    }
    this._terminalCalled.add(taskId)

    try {
      if (status === 'done' || status === 'review') {
        this._metrics.increment('agentsCompleted')
      } else if (status === 'failed' || status === 'error') {
        this._metrics.increment('agentsFailed')
      }

      if (this.config.onStatusTerminal) {
        this.config.onStatusTerminal(taskId, status)
      } else {
        // DESIGN: Inline resolution for immediate drain loop feedback.
        // When a pipeline agent completes, we resolve dependents synchronously
        // so the drain loop can claim newly-unblocked tasks in the same tick.
        try {
          resolveDependents(
            taskId,
            status,
            this.dependencyResolver.depIndex,
            this.repo.getTask,
            this.repo.updateTask,
            this.logger,
            getSetting,
            this.dependencyResolver.epicIndex,
            this.repo.getGroup,
            this.repo.getGroupTasks
          )
        } catch (err) {
          this.logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
        }
      }
    } finally {
      // Clean up after 5 seconds to prevent unbounded memory growth
      setTimeout(() => this._terminalCalled.delete(taskId), 5000)
    }
  }

  // ---- Public methods ----

  start(): void {
    if (this._running) return
    this._running = true
    this._shuttingDown = false
    this._concurrency = makeConcurrencyState(this.config.maxConcurrent)

    // Initialize dependency resolver
    this.dependencyResolver.initialize()

    // Initial orphan recovery (fire-and-forget)
    this.supervisor.runOrphanRecovery(this._activeAgents).catch((err) => {
      this.logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
    })

    // Initial worktree prune (fire-and-forget)
    this.supervisor.runWorktreePrune(this._activeAgents).catch((err) => {
      this.logger.error(`[agent-manager] Initial worktree prune error: ${err}`)
    })

    // Start periodic loops
    this.pollTimer = setInterval(() => {
      if (this._drainInFlight) return // skip if previous drain still running
      this._drainInFlight = this.scheduler
        .runDrain(
          this._shuttingDown,
          this._activeAgents,
          this._processingTasks,
          this._agentPromises,
          this._concurrency,
          this.onTaskTerminal.bind(this)
        )
        .then((updatedConcurrency) => {
          this._concurrency = updatedConcurrency
        })
        .catch((err) => this.logger.warn(`[agent-manager] Drain loop error: ${err}`))
        .finally(() => {
          this._drainInFlight = null
        })
    }, this.config.pollIntervalMs)

    this.watchdogTimer = setInterval(() => {
      this.supervisor
        .runWatchdog(
          this._activeAgents,
          this._processingTasks,
          this._concurrency,
          this.onTaskTerminal.bind(this)
        )
        .then((updatedConcurrency) => {
          this._concurrency = updatedConcurrency
        })
        .catch((err) => this.logger.warn(`[agent-manager] Watchdog error: ${err}`))
    }, WATCHDOG_INTERVAL_MS)

    this.orphanTimer = setInterval(() => {
      this.supervisor
        .runOrphanRecovery(this._activeAgents)
        .catch((err) => this.logger.warn(`[agent-manager] Orphan loop error: ${err}`))
    }, ORPHAN_CHECK_INTERVAL_MS)

    this.pruneTimer = setInterval(() => {
      this.supervisor
        .runWorktreePrune(this._activeAgents)
        .catch((err) => this.logger.warn(`[agent-manager] Prune loop error: ${err}`))
    }, WORKTREE_PRUNE_INTERVAL_MS)

    // Defer initial drain to let the event loop settle and orphan recovery complete
    setTimeout(() => {
      this._drainInFlight = (async () => {
        // Wait for orphan recovery to complete before draining
        try {
          await this.supervisor.runOrphanRecovery(this._activeAgents)
        } catch (err) {
          this.logger.error(`[agent-manager] Orphan recovery before initial drain error: ${err}`)
        }
        const updatedConcurrency = await this.scheduler.runDrain(
          this._shuttingDown,
          this._activeAgents,
          this._processingTasks,
          this._agentPromises,
          this._concurrency,
          this.onTaskTerminal.bind(this)
        )
        this._concurrency = updatedConcurrency
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
      await this._drainInFlight.catch((err) => {
        this.logger.warn(
          `[agent-manager] Drain in-flight failed during shutdown: ${getErrorMessage(err)}`
        )
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
      concurrency: this._concurrency,
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
      return { killed: false, error: 'Agent not found' }
    }
    try {
      agent.handle.abort()
      this._activeAgents.delete(taskId)
      return { killed: true }
    } catch (err) {
      return { killed: false, error: getErrorMessage(err) }
    }
  }
}

export function createAgentManager(
  config: AgentManagerConfig,
  repo: ISprintTaskRepository,
  logger: Logger = defaultLogger
): AgentManager {
  return new AgentManagerImpl(config, repo, logger)
}
