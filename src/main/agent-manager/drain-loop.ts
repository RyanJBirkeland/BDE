/**
 * Drain loop — polling orchestration that claims queued tasks and spawns agents.
 *
 * The `DrainLoop` class owns all mutable drain-loop state. The constructor
 * accepts a `DrainLoopDeps` struct of read-only collaborators — external
 * services and stable callbacks. No mutable fields appear in `DrainLoopDeps`.
 *
 * The exported pure-function wrappers (`validateDrainPreconditions`,
 * `buildTaskStatusMap`, `drainQueuedTasks`, `runDrain`) are retained for
 * backward compatibility with existing unit tests and external callers.
 */

import type { Logger } from '../logger'
import type { AgentManagerConfig, ActiveAgent } from './types'
import type { TaskStatus } from '../../shared/task-state-machine'
import { NOTES_MAX_LENGTH, DRAIN_PAUSE_ON_ENV_ERROR_MS } from './types'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { TaskStateService } from '../services/task-state-service'
import type { DependencyIndex } from '../services/dependency-service'
import type { MetricsCollector } from './metrics'
import type { ConcurrencyState } from './concurrency'
import { availableSlots, tryRecover, makeConcurrencyState } from './concurrency'
import { checkOAuthToken } from './oauth-checker'
import {
  computeDepsFingerprint,
  refreshDependencyIndex,
  type DepsFingerprint
} from './dependency-refresher'
import { getConfiguredRepos } from '../paths'
import type { SprintTask } from '../../shared/types/task-types'
import { classifyFailureReason } from './failure-classifier'
import type { AgentManagerDrainPausedEvent } from '../../shared/ipc-channels/broadcast-channels'
import { sleep } from '../lib/async-utils'

// ---------------------------------------------------------------------------
// Drain tick deadline
// ---------------------------------------------------------------------------

/** Hard per-tick deadline for the DB read inside each drain tick. */
export const DRAIN_TICK_TIMEOUT_MS = 10_000

/**
 * Thrown when `getQueuedTasks` does not return within `DRAIN_TICK_TIMEOUT_MS`.
 * The drain loop catches this, logs the event, and skips the tick rather than
 * hanging indefinitely on a locked WAL or stalled filesystem.
 */
export class DrainTimeoutError extends Error {
  constructor(tickId: string) {
    super(`Drain tick ${tickId} timed out after ${DRAIN_TICK_TIMEOUT_MS}ms`)
    this.name = 'DrainTimeoutError'
  }
}

/**
 * Defers `fn` to the next event-loop iteration via `setImmediate`.
 * This gives the Node.js event loop a chance to process pending callbacks
 * before the synchronous `better-sqlite3` call occupies the thread.
 */
function runInNextTick<T>(fn: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) =>
    setImmediate(() => {
      try {
        resolve(fn())
      } catch (err) {
        reject(err)
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Read-only collaborators interface
// ---------------------------------------------------------------------------

export const DRAIN_QUARANTINE_THRESHOLD = 3

/**
 * Read-only collaborators injected into the `DrainLoop` constructor.
 * Every field here is a stable reference or a pure callback — no mutable
 * bookkeeping state. Mutable drain state lives on `DrainLoop` itself.
 */
export interface DrainLoopDeps {
  config: AgentManagerConfig
  repo: IAgentTaskRepository
  depIndex: DependencyIndex
  metrics: MetricsCollector
  logger: Logger
  isShuttingDown: () => boolean
  isCircuitOpen: (now?: number) => boolean
  activeAgents: Map<string, ActiveAgent>
  /** Returns the count of spawned agents not yet registered in activeAgents. */
  getPendingSpawns: () => number
  /** Returns true when a terminal event has fired since the last dep-index rebuild. */
  isDepIndexDirty: () => boolean
  /** Clears the dirty flag on the owner after a successful dep-index rebuild. */
  setDepIndexDirty: (dirty: boolean) => void
  processQueuedTask: (rawTask: SprintTask, taskStatusMap: Map<string, string>) => Promise<void>
  /** Called when a task is quarantined so dependency resolution runs. */
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  /** Central status-transition service — used by applyQuarantine. */
  taskStateService: TaskStateService
  /** Broadcasts the drain-paused event to the renderer. */
  emitDrainPaused: (event: AgentManagerDrainPausedEvent) => void
  /**
   * Resolves when any in-flight OAuth token refresh has completed.
   * The drain loop awaits this before each spawn. Optional — tests omit it.
   */
  awaitOAuthRefresh?: () => Promise<void>
}

// ---------------------------------------------------------------------------
// DrainLoop class — owns mutable drain-loop state
// ---------------------------------------------------------------------------

/**
 * Owns the mutable state for the drain loop and exposes `runDrain()`.
 *
 * Mutable state fields:
 *  - `_concurrency`         — slot limits and recovery window, shared with watchdog via accessors
 *  - `drainFailureCounts`   — per-task consecutive failure counter
 *  - `drainPausedUntil`     — environmental-pause gate
 *  - `lastTaskDeps`         — fingerprint cache for incremental dep-index refresh
 *  - `recentlyProcessedTaskIds` — dirty-set hint for the next tick's dep refresh
 */
export class DrainLoop {
  /** Concurrency state — shared read/write via getConcurrency/setConcurrency accessors. */
  private _concurrency: ConcurrencyState
  /** Per-task consecutive processing-failure counts. Cleared on success or quarantine. */
  private drainFailureCounts = new Map<string, number>()
  /** Unix-ms; when set and > Date.now(), the drain tick short-circuits. */
  private drainPausedUntil: number | undefined
  /** Fingerprint cache for the incremental dependency refresher. */
  private lastTaskDeps: DepsFingerprint = new Map()
  /** IDs claimed in the most recent tick, forwarded as a dirty-set hint. Accessible via getter. */
  private _recentlyProcessedTaskIds = new Set<string>()

  constructor(
    private readonly deps: DrainLoopDeps,
    initialConcurrency?: ConcurrencyState
  ) {
    this._concurrency = initialConcurrency ?? makeConcurrencyState(deps.config.maxConcurrent)
  }

  // ---- Public accessors (for watchdog and other loops) ----

  getConcurrency(): ConcurrencyState {
    return this._concurrency
  }

  setConcurrency(state: ConcurrencyState): void {
    this._concurrency = state
  }

  /** Called by AgentManagerImpl.onTaskTerminal to ensure the next tick rebuilds the dep index. */
  notifyRecentlyProcessedTask(taskId: string): void {
    this._recentlyProcessedTaskIds.add(taskId)
  }

  /**
   * Exposed for task-claimer.ts to record newly claimed task IDs as a dirty-set
   * hint for the next tick's dep-index refresh.
   */
  get recentlyProcessedTaskIds(): Set<string> {
    return this._recentlyProcessedTaskIds
  }

  /**
   * Seeds the internal dep-fingerprint cache from a pre-loaded task list.
   * Called by `AgentManagerImpl.initDependencyIndex()` at startup so the first
   * drain tick can use incremental refreshes rather than a full rebuild.
   */
  initializeFingerprintsFrom(tasks: Array<{ id: string; depends_on: import('../../shared/types').TaskDependency[] | null }>): void {
    this.lastTaskDeps.clear()
    for (const task of tasks) {
      const taskDeps = task.depends_on ?? null
      this.lastTaskDeps.set(task.id, {
        deps: taskDeps,
        hash: computeDepsFingerprint(taskDeps)
      })
    }
  }

  // ---- Main entry point ----

  async runDrain(): Promise<void> {
    const tickId = Math.random().toString(16).slice(2, 10)

    this.deps.logger.info(
      `[agent-manager] Drain loop starting (shuttingDown=${this.deps.isShuttingDown()}, slots=${availableSlots(this._concurrency, this.deps.activeAgents.size)})`
    )

    if (this.drainPausedUntil && Date.now() < this.drainPausedUntil) {
      this.deps.logger.info(
        `[drain-loop] skipping tick — paused until ${new Date(this.drainPausedUntil).toISOString()}`
      )
      return
    }

    if (!(await this.validateDrainPreconditions())) return

    this.deps.metrics.increment('drainLoopCount')
    const drainStart = Date.now()

    const taskStatusMap = this.buildTaskStatusMap()

    const available = availableSlots(this._concurrency, this.deps.activeAgents.size)
    if (available <= 0) {
      this.deps.logger.debug(`drain.tick.idle tickId=${tickId} queuedCount=0`)
      this.deps.logger.event('drain.tick.idle', { tickId, queuedCount: 0 })
      return
    }

    try {
      await this.drainQueuedTasksInternal(available, taskStatusMap, tickId)
    } catch (err) {
      this.deps.logger.error(`[agent-manager] Drain loop error: ${err}`)
    }

    this.deps.metrics.setLastDrainDuration(Date.now() - drainStart)
    this._concurrency = tryRecover(this._concurrency, Date.now())
  }

  // ---- Named phases (testable via backward-compat wrappers) ----

  async validateDrainPreconditions(): Promise<boolean> {
    if (this.deps.isShuttingDown()) return false

    if (this.deps.isCircuitOpen()) {
      this.deps.logger.warn('[agent-manager] Skipping drain — circuit breaker open')
      return false
    }

    const repos = getConfiguredRepos()
    if (repos.length === 0) {
      this.deps.logger.warn(
        '[drain] No repositories configured — skipping drain cycle. Configure repos in Settings.'
      )
      return false
    }

    const tokenOk = await checkOAuthToken(this.deps.logger)
    if (!tokenOk) {
      this.deps.logger.warn('[drain] OAuth token invalid — skipping drain tick')
      return false
    }
    return true
  }

  buildTaskStatusMap(): Map<string, string> {
    if (this.deps.isDepIndexDirty()) {
      try {
        const allTasks = this.deps.repo.getTasksWithDependencies()
        this.deps.depIndex.rebuild(allTasks)
        this.lastTaskDeps.clear()
        for (const task of allTasks) {
          const taskDeps = task.depends_on ?? null
          this.lastTaskDeps.set(task.id, {
            deps: taskDeps,
            hash: computeDepsFingerprint(taskDeps)
          })
        }
        this.deps.setDepIndexDirty(false)
        return new Map(allTasks.map((task) => [task.id, task.status]))
      } catch (err) {
        this.deps.logger.error(
          `[agent-manager] Dep-index full rebuild failed — falling back to incremental refresh: ${err}`
        )
        // Clear dirty so we don't retry the full rebuild every tick while the repo is unavailable.
        this.deps.setDepIndexDirty(false)
      }
    }
    const dirty = new Set(this._recentlyProcessedTaskIds)
    this._recentlyProcessedTaskIds.clear()
    return refreshDependencyIndex(
      this.deps.depIndex,
      this.lastTaskDeps,
      this.deps.repo,
      this.deps.logger,
      dirty
    )
  }

  async drainQueuedTasksWithMap(
    available: number,
    taskStatusMap: Map<string, string>
  ): Promise<void> {
    return this.drainQueuedTasksInternal(available, taskStatusMap, 'unknown')
  }

  // ---- Private helpers ----

  private async drainQueuedTasksInternal(
    available: number,
    taskStatusMap: Map<string, string>,
    tickId: string
  ): Promise<void> {
    const freshSlots = availableSlots(this._concurrency, this.deps.activeAgents.size)
    const limit = Math.min(available, freshSlots)
    this.deps.logger.info(`[agent-manager] Fetching queued tasks (limit=${limit})...`)

    let queued: SprintTask[]
    try {
      queued = await Promise.race([
        runInNextTick(() => this.deps.repo.getQueuedTasks(limit)),
        sleep(DRAIN_TICK_TIMEOUT_MS).then(() => {
          throw new DrainTimeoutError(tickId)
        })
      ])
    } catch (err) {
      if (err instanceof DrainTimeoutError) {
        this.deps.logger.event('drain.tick.timeout', { tickId })
        return
      }
      throw err
    }

    this.deps.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
    for (const rawTask of queued) {
      if (this.deps.isShuttingDown()) break
      if (
        availableSlots(this._concurrency, this.deps.activeAgents.size + this.deps.getPendingSpawns()) <= 0
      ) {
        this.deps.logger.info('[agent-manager] No slots available — stopping drain iteration')
        break
      }
      await this.deps.awaitOAuthRefresh?.()
      const taskId = rawTask.id
      try {
        await this.deps.processQueuedTask(rawTask, taskStatusMap)
        if (taskId) this.drainFailureCounts.delete(taskId)
      } catch (err) {
        this.deps.logger.error(`[agent-manager] Failed to process task ${taskId}: ${err}`)
        if (!taskId) continue
        if (await this.handleEnvironmentalFailure(taskId, err)) return
        this.handleSpecLevelFailure(taskId, err)
      }
    }
  }

  private async handleEnvironmentalFailure(taskId: string, err: unknown): Promise<boolean> {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    if (classifyFailureReason(message) !== 'environmental') return false

    const reason = (message.split('\n')[0] ?? '').slice(0, 200)
    try {
      await this.deps.repo.updateTask(taskId, {
        status: 'queued',
        failure_reason: 'environmental',
        claimed_by: null,
        notes: reason
      })
    } catch (writeErr) {
      this.deps.logger.warn(
        `[drain-loop] failed to annotate queued task ${taskId} with environmental failure: ${writeErr}`
      )
    }

    const pausedUntil = Date.now() + DRAIN_PAUSE_ON_ENV_ERROR_MS
    const affectedTaskCount = this.readQueueDepth()
    this.drainPausedUntil = pausedUntil
    this.deps.emitDrainPaused({ reason, pausedUntil, affectedTaskCount })
    this.deps.logger.warn(
      `[drain-loop] environmental failure — pausing drain until ${new Date(pausedUntil).toISOString()}: ${reason}`
    )
    return true
  }

  private readQueueDepth(): number {
    try {
      return this.deps.repo.getQueueStats().queued ?? 0
    } catch {
      return 0
    }
  }

  private handleSpecLevelFailure(taskId: string, err: unknown): void {
    const count = (this.drainFailureCounts.get(taskId) ?? 0) + 1
    this.drainFailureCounts.set(taskId, count)
    if (!shouldQuarantine(count)) return

    this.deps.logger.error(
      `[agent-manager] Task ${taskId} failed ${count} consecutive times — quarantining to prevent drain churn`
    )
    const note = formatQuarantineNote(count, err)
    this.applyQuarantine(taskId, note)
  }

  private applyQuarantine(taskId: string, note: string): void {
    try {
      const currentTask = this.deps.repo.getTask(taskId)
      const status = quarantineStatusFor(currentTask?.status)
      this.deps.taskStateService
        .transition(taskId, status, {
          fields: { notes: note, claimed_by: null },
          caller: 'drain-loop:quarantine'
        })
        .then(() => {
          this.drainFailureCounts.delete(taskId)
        })
        .catch((termErr) =>
          this.deps.logger.warn(`[agent-manager] transition failed for quarantined task ${taskId}: ${termErr}`)
        )
    } catch (quarantineErr) {
      this.deps.logger.error(`[agent-manager] Failed to quarantine task ${taskId}: ${quarantineErr}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible pure-function exports
// ---------------------------------------------------------------------------
// These allow existing unit tests (`runDrain(deps)` style) to continue working.
// New code should construct a `DrainLoop` instance directly.

/**
 * @deprecated Use `new DrainLoop(deps).validateDrainPreconditions()`.
 */
export async function validateDrainPreconditions(deps: DrainLoopDeps): Promise<boolean> {
  return new DrainLoop(deps).validateDrainPreconditions()
}

/**
 * @deprecated Use `new DrainLoop(deps).buildTaskStatusMap()`.
 */
export function buildTaskStatusMap(deps: DrainLoopDeps): Map<string, string> {
  return new DrainLoop(deps).buildTaskStatusMap()
}

/**
 * @deprecated Use `new DrainLoop(deps).drainQueuedTasksWithMap(available, map)`.
 */
export async function drainQueuedTasks(
  available: number,
  taskStatusMap: Map<string, string>,
  deps: DrainLoopDeps
): Promise<void> {
  return new DrainLoop(deps).drainQueuedTasksWithMap(available, taskStatusMap)
}

/**
 * @deprecated Use `new DrainLoop(deps).runDrain()`.
 */
export async function runDrain(deps: DrainLoopDeps): Promise<void> {
  return new DrainLoop(deps).runDrain()
}

// ---------------------------------------------------------------------------
// Private pure helpers
// ---------------------------------------------------------------------------

function shouldQuarantine(consecutiveFailures: number): boolean {
  return consecutiveFailures >= DRAIN_QUARANTINE_THRESHOLD
}

function formatQuarantineNote(count: number, err: unknown): string {
  const errMsg = err instanceof Error ? err.message : String(err)
  const note = `Task processing failed ${count} consecutive times in the drain loop: ${errMsg}. Check ~/.bde/bde.log for details.`
  return note.length > NOTES_MAX_LENGTH ? note.slice(0, NOTES_MAX_LENGTH - 3) + '...' : note
}

function quarantineStatusFor(currentStatus: string | undefined): 'cancelled' | 'error' {
  return currentStatus === 'queued' ? 'cancelled' : 'error'
}
