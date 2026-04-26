/**
 * Drain loop — polling orchestration that claims queued tasks and spawns agents.
 *
 * Exported as pure functions so they can be unit-tested without a live
 * AgentManagerImpl instance. The class delegates to these functions via a
 * `DrainLoopDeps` struct injected at call sites.
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
import { availableSlots, tryRecover } from './concurrency'
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
 * Note: does not prevent a truly blocking DB call from stalling the loop —
 * the race with `sleep(DRAIN_TICK_TIMEOUT_MS)` is still the safety net.
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
// Deps interface
// ---------------------------------------------------------------------------

export const DRAIN_QUARANTINE_THRESHOLD = 3

export interface DrainLoopDeps {
  config: AgentManagerConfig
  repo: IAgentTaskRepository
  depIndex: DependencyIndex
  metrics: MetricsCollector
  logger: Logger
  isShuttingDown: () => boolean
  isCircuitOpen: (now?: number) => boolean
  circuitOpenUntil: number
  activeAgents: ReadonlyMap<string, ActiveAgent>
  /** Returns the live ConcurrencyState — called each time to avoid stale captures. */
  getConcurrency: () => ConcurrencyState
  /** Returns the count of spawned agents not yet registered in activeAgents. */
  getPendingSpawns: () => number
  lastTaskDeps: DepsFingerprint
  isDepIndexDirty: () => boolean
  setDepIndexDirty: (dirty: boolean) => void
  setConcurrency: (state: ConcurrencyState) => void
  processQueuedTask: (rawTask: SprintTask, taskStatusMap: Map<string, string>) => Promise<void>
  /** Increment the consecutive drain-failure count for a task. */
  incrementDrainFailure: (taskId: string) => void
  /** Clear the consecutive drain-failure count for a task (called on success or quarantine). */
  clearDrainFailure: (taskId: string) => void
  /** Returns the current consecutive drain-failure count for a task. */
  drainFailureCountFor: (taskId: string) => number
  /** Called when a task is quarantined after repeated failures so dependency resolution runs. */
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  /** Central status-transition service — used by applyQuarantine to route status writes. */
  taskStateService: TaskStateService
  /** Called when drain pauses because of an environmental failure. */
  emitDrainPaused: (event: AgentManagerDrainPausedEvent) => void
  /** Unix-ms; when set and > Date.now(), the drain tick short-circuits. */
  drainPausedUntil: number | undefined
  /**
   * Short random hex token generated once per runDrain() invocation.
   * Threads through processQueuedTask → spawnAgent so every event in
   * a single drain tick can be correlated in the log.
   */
  tickId?: string
  /**
   * IDs of tasks claimed since the previous drain tick. Used as a hint to
   * `refreshDependencyIndex`: tasks outside this set whose fingerprint is
   * already cached are presumed dependency-stable for the upcoming tick and
   * skip the per-task fingerprint re-compute. The set is consumed and cleared
   * at the start of every drain tick so a task only counts as dirty once.
   */
  recentlyProcessedTaskIds: Set<string>
  /**
   * Resolves when any in-flight OAuth token refresh has completed.
   * The drain loop awaits this before each spawn so the refreshed token
   * is on disk before the next SDK process reads `~/.bde/oauth-token`.
   * Optional — callers that don't inject AgentManager (tests) omit it.
   */
  awaitOAuthRefresh?: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Precondition check
// ---------------------------------------------------------------------------

/**
 * Guard checks before running a drain tick.
 * Returns false (and logs as needed) if the drain should be skipped.
 */
export async function validateDrainPreconditions(deps: DrainLoopDeps): Promise<boolean> {
  if (deps.isShuttingDown()) return false

  if (deps.isCircuitOpen()) {
    deps.logger.warn(
      `[agent-manager] Skipping drain — circuit breaker open until ${new Date(
        deps.circuitOpenUntil
      ).toISOString()}`
    )
    return false
  }

  const repos = getConfiguredRepos()
  if (repos.length === 0) {
    deps.logger.warn(
      '[drain] No repositories configured — skipping drain cycle. Configure repos in Settings.'
    )
    return false
  }

  const tokenOk = await checkOAuthToken(deps.logger)
  if (!tokenOk) {
    deps.logger.warn('[drain] OAuth token invalid — skipping drain tick')
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Drain tick helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh `taskStatusMap` for the drain tick.
 *
 * On a dirty dep-index (terminal event fired since last tick) performs a full
 * rebuild; otherwise uses the incremental refresher.
 */
export function buildTaskStatusMap(deps: DrainLoopDeps): Map<string, string> {
  if (deps.isDepIndexDirty()) {
    try {
      const allTasks = deps.repo.getTasksWithDependencies()
      deps.depIndex.rebuild(allTasks)
      deps.lastTaskDeps.clear()
      for (const task of allTasks) {
        const taskDeps = task.depends_on ?? null
        deps.lastTaskDeps.set(task.id, {
          deps: taskDeps,
          hash: computeDepsFingerprint(taskDeps)
        })
      }
      deps.setDepIndexDirty(false)
      return new Map(allTasks.map((task) => [task.id, task.status]))
    } catch (err) {
      deps.logger.error(
        `[agent-manager] Dep-index full rebuild failed — falling back to incremental refresh: ${err}`
      )
      // Clear dirty flag so we don't retry the full rebuild on every tick while the
      // repo is unavailable. The incremental refresher below will re-set it dirty
      // when tasks change again.
      deps.setDepIndexDirty(false)
    }
  }
  const dirty = new Set(deps.recentlyProcessedTaskIds)
  deps.recentlyProcessedTaskIds.clear()
  return refreshDependencyIndex(
    deps.depIndex,
    deps.lastTaskDeps,
    deps.repo,
    deps.logger,
    dirty
  )
}

/**
 * Fetch queued tasks (up to `available` slots) and process each one.
 * Stops early if shuttingDown is set or all slots fill mid-loop.
 * Errors from individual tasks are logged but do not stop the loop.
 */
export async function drainQueuedTasks(
  available: number,
  taskStatusMap: Map<string, string>,
  deps: DrainLoopDeps
): Promise<void> {
  // Re-read slots at dispatch time to account for agents that registered between
  // the slot check in runDrain and the actual fetch — limits how many tasks we pull.
  const freshSlots = availableSlots(deps.getConcurrency(), deps.activeAgents.size)
  const limit = Math.min(available, freshSlots)
  deps.logger.info(`[agent-manager] Fetching queued tasks (limit=${limit})...`)

  const tickId = deps.tickId ?? 'unknown'
  let queued: SprintTask[]
  try {
    queued = await Promise.race([
      runInNextTick(() => deps.repo.getQueuedTasks(limit)),
      sleep(DRAIN_TICK_TIMEOUT_MS).then(() => {
        throw new DrainTimeoutError(tickId)
      })
    ])
  } catch (err) {
    if (err instanceof DrainTimeoutError) {
      deps.logger.event('drain.tick.timeout', { tickId })
      return
    }
    throw err
  }

  deps.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
  for (const rawTask of queued) {
    if (deps.isShuttingDown()) break
    if (
      availableSlots(deps.getConcurrency(), deps.activeAgents.size + deps.getPendingSpawns()) <= 0
    ) {
      deps.logger.info('[agent-manager] No slots available — stopping drain iteration')
      break
    }
    // Wait for any in-flight OAuth refresh before spawning so the new agent
    // reads the refreshed token rather than the stale one that caused the error.
    await deps.awaitOAuthRefresh?.()
    const taskId = rawTask.id
    try {
      await deps.processQueuedTask(rawTask, taskStatusMap)
      // Clear failure count on successful processing — task is no longer churning.
      if (taskId) deps.clearDrainFailure(taskId)
    } catch (err) {
      deps.logger.error(`[agent-manager] Failed to process task ${taskId}: ${err}`)
      if (!taskId) continue
      if (await handleEnvironmentalFailure(taskId, err, deps)) return
      handleSpecLevelFailure(taskId, err, deps)
    }
  }
}

/**
 * Classify a per-task error as environmental (main-repo dirty, auth missing,
 * network). When it is, leave the task queued so it can retry after the user
 * fixes the environment, emit a pause event, and tell the caller to stop
 * iterating the drain so the remaining queued tasks don't burn to `error`.
 *
 * Returns `true` when the failure was environmental (caller should `return`).
 */
async function handleEnvironmentalFailure(taskId: string, err: unknown, deps: DrainLoopDeps): Promise<boolean> {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
  if (classifyFailureReason(message) !== 'environmental') return false

  const reason = (message.split('\n')[0] ?? '').slice(0, 200)
  try {
    await deps.repo.updateTask(taskId, {
      status: 'queued',
      failure_reason: 'environmental',
      claimed_by: null,
      notes: reason
    })
  } catch (writeErr) {
    deps.logger.warn(
      `[drain-loop] failed to annotate queued task ${taskId} with environmental failure: ${writeErr}`
    )
  }

  const pausedUntil = Date.now() + DRAIN_PAUSE_ON_ENV_ERROR_MS
  const affectedTaskCount = readQueueDepth(deps)
  deps.emitDrainPaused({ reason, pausedUntil, affectedTaskCount })
  deps.logger.warn(
    `[drain-loop] environmental failure — pausing drain until ${new Date(pausedUntil).toISOString()}: ${reason}`
  )
  return true
}

function readQueueDepth(deps: DrainLoopDeps): number {
  try {
    return deps.repo.getQueueStats().queued ?? 0
  } catch {
    return 0
  }
}

/**
 * Spec-level failure path — counts consecutive failures and quarantines the
 * task after `DRAIN_QUARANTINE_THRESHOLD` churns.
 *
 * Pure dispatch: increment the counter, check the threshold, build a note,
 * delegate to `applyQuarantine`. Each step has a single responsibility.
 */
function handleSpecLevelFailure(taskId: string, err: unknown, deps: DrainLoopDeps): void {
  deps.incrementDrainFailure(taskId)
  const count = deps.drainFailureCountFor(taskId)
  if (!shouldQuarantine(count)) return

  deps.logger.error(
    `[agent-manager] Task ${taskId} failed ${count} consecutive times — quarantining to prevent drain churn`
  )
  const note = formatQuarantineNote(count, err)
  applyQuarantine(taskId, note, deps)
}

function shouldQuarantine(consecutiveFailures: number): boolean {
  return consecutiveFailures >= DRAIN_QUARANTINE_THRESHOLD
}

function formatQuarantineNote(count: number, err: unknown): string {
  const errMsg = err instanceof Error ? err.message : String(err)
  const note = `Task processing failed ${count} consecutive times in the drain loop: ${errMsg}. Check ~/.bde/bde.log for details.`
  return note.length > NOTES_MAX_LENGTH ? note.slice(0, NOTES_MAX_LENGTH - 3) + '...' : note
}

/**
 * Choose `cancelled` for a task that never moved past `queued` (the agent
 * never started — the queue itself is the failure surface) and `error` for
 * everything else (the agent started, then failed).
 */
function quarantineStatusFor(currentStatus: string | undefined): 'cancelled' | 'error' {
  return currentStatus === 'queued' ? 'cancelled' : 'error'
}

function applyQuarantine(taskId: string, note: string, deps: DrainLoopDeps): void {
  try {
    const currentTask = deps.repo.getTask(taskId)
    const status = quarantineStatusFor(currentTask?.status)
    deps.taskStateService
      .transition(taskId, status, {
        fields: { notes: note, claimed_by: null },
        caller: 'drain-loop:quarantine'
      })
      .then(() => {
        // Clear the failure count only after a successful status write —
        // if the write fails the count must stay so future ticks can re-quarantine.
        deps.clearDrainFailure(taskId)
      })
      .catch((termErr) =>
        deps.logger.warn(`[agent-manager] transition failed for quarantined task ${taskId}: ${termErr}`)
      )
  } catch (quarantineErr) {
    deps.logger.error(`[agent-manager] Failed to quarantine task ${taskId}: ${quarantineErr}`)
  }
}

// ---------------------------------------------------------------------------
// Main drain tick
// ---------------------------------------------------------------------------

/**
 * Execute one drain tick: precondition check → dep index refresh →
 * slot availability check → process queued tasks.
 *
 * The concurrency guard (skip if previous drain still running) is handled by
 * the caller via `_drainInFlight` — this function is the body of that promise.
 */
export async function runDrain(deps: DrainLoopDeps): Promise<void> {
  const tickId = Math.random().toString(16).slice(2, 10)
  deps.tickId = tickId

  deps.logger.info(
    `[agent-manager] Drain loop starting (shuttingDown=${deps.isShuttingDown()}, slots=${availableSlots(deps.getConcurrency(), deps.activeAgents.size)})`
  )

  if (deps.drainPausedUntil && Date.now() < deps.drainPausedUntil) {
    deps.logger.info(
      `[drain-loop] skipping tick — paused until ${new Date(deps.drainPausedUntil).toISOString()}`
    )
    return
  }

  if (!(await validateDrainPreconditions(deps))) return

  deps.metrics.increment('drainLoopCount')
  const drainStart = Date.now()

  const taskStatusMap = buildTaskStatusMap(deps)

  const available = availableSlots(deps.getConcurrency(), deps.activeAgents.size)
  if (available <= 0) {
    deps.logger.debug(`drain.tick.idle tickId=${tickId} queuedCount=0`)
    deps.logger.event('drain.tick.idle', { tickId, queuedCount: 0 })
    return
  }

  try {
    await drainQueuedTasks(available, taskStatusMap, deps)
  } catch (err) {
    deps.logger.error(`[agent-manager] Drain loop error: ${err}`)
  }

  deps.metrics.setLastDrainDuration(Date.now() - drainStart)
  deps.setConcurrency(tryRecover(deps.getConcurrency(), Date.now()))
}
