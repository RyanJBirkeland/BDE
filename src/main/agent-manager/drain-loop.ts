/**
 * Drain loop — polling orchestration that claims queued tasks and spawns agents.
 *
 * Exported as pure functions so they can be unit-tested without a live
 * AgentManagerImpl instance. The class delegates to these functions via a
 * `DrainLoopDeps` struct injected at call sites.
 */

import type { Logger } from '../logger'
import type { AgentManagerConfig, ActiveAgent } from './types'
import { NOTES_MAX_LENGTH, DRAIN_PAUSE_ON_ENV_ERROR_MS } from './types'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
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
  activeAgents: Map<string, ActiveAgent>
  /** Returns the live ConcurrencyState — called each time to avoid stale captures. */
  getConcurrency: () => ConcurrencyState
  /** Returns the count of spawned agents not yet registered in activeAgents. */
  getPendingSpawns: () => number
  lastTaskDeps: DepsFingerprint
  isDepIndexDirty: () => boolean
  setDepIndexDirty: (dirty: boolean) => void
  setConcurrency: (state: ConcurrencyState) => void
  processQueuedTask: (rawTask: SprintTask, taskStatusMap: Map<string, string>) => Promise<void>
  /** Counts consecutive drain-loop failures per task. Lives on AgentManagerImpl, passed in to persist across ticks. */
  drainFailureCounts: Map<string, number>
  /** Called when a task is quarantined after repeated failures so dependency resolution runs. */
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  /** Called when drain pauses because of an environmental failure. */
  emitDrainPaused: (event: AgentManagerDrainPausedEvent) => void
  /** Unix-ms; when set and > Date.now(), the drain tick short-circuits. */
  drainPausedUntil: number | undefined
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
  return refreshDependencyIndex(deps.depIndex, deps.lastTaskDeps, deps.repo, deps.logger)
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
  const queued = deps.repo.getQueuedTasks(limit)
  deps.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
  for (const rawTask of queued) {
    if (deps.isShuttingDown()) break
    if (
      availableSlots(deps.getConcurrency(), deps.activeAgents.size + deps.getPendingSpawns()) <= 0
    ) {
      deps.logger.info('[agent-manager] No slots available — stopping drain iteration')
      break
    }
    const taskId = rawTask.id
    try {
      await deps.processQueuedTask(rawTask, taskStatusMap)
      // Clear failure count on successful processing — task is no longer churning.
      if (taskId) deps.drainFailureCounts.delete(taskId)
    } catch (err) {
      deps.logger.error(`[agent-manager] Failed to process task ${taskId}: ${err}`)
      if (!taskId) continue
      if (handleEnvironmentalFailure(taskId, err, deps)) return
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
function handleEnvironmentalFailure(taskId: string, err: unknown, deps: DrainLoopDeps): boolean {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
  if (classifyFailureReason(message) !== 'environmental') return false

  const reason = (message.split('\n')[0] ?? '').slice(0, 200)
  try {
    deps.repo.updateTask(taskId, {
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
 * Original spec-level failure path — counts consecutive failures and quarantines
 * the task after `DRAIN_QUARANTINE_THRESHOLD` churns. Unchanged from pre-pause
 * behavior; only lifted out so the catch block can branch on classification.
 */
function handleSpecLevelFailure(taskId: string, err: unknown, deps: DrainLoopDeps): void {
  const count = (deps.drainFailureCounts.get(taskId) ?? 0) + 1
  deps.drainFailureCounts.set(taskId, count)
  if (count < DRAIN_QUARANTINE_THRESHOLD) return

  deps.logger.error(
    `[agent-manager] Task ${taskId} failed ${count} consecutive times — quarantining to prevent drain churn`
  )
  const errMsg = err instanceof Error ? err.message : String(err)
  const note = `Task processing failed ${count} consecutive times in the drain loop: ${errMsg}. Check ~/.bde/bde.log for details.`
  const truncated =
    note.length > NOTES_MAX_LENGTH ? note.slice(0, NOTES_MAX_LENGTH - 3) + '...' : note
  try {
    const currentTask = deps.repo.getTask(taskId)
    const quarantineStatus: 'cancelled' | 'error' =
      currentTask?.status === 'queued' ? 'cancelled' : 'error'
    deps.repo.updateTask(taskId, {
      status: quarantineStatus,
      notes: truncated,
      claimed_by: null
    })
    deps.drainFailureCounts.delete(taskId)
    deps
      .onTaskTerminal(taskId, quarantineStatus)
      .catch((termErr) =>
        deps.logger.warn(
          `[agent-manager] onTerminal failed for quarantined task ${taskId}: ${termErr}`
        )
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
  if (available <= 0) return

  try {
    await drainQueuedTasks(available, taskStatusMap, deps)
  } catch (err) {
    deps.logger.error(`[agent-manager] Drain loop error: ${err}`)
  }

  deps.metrics.setLastDrainDuration(Date.now() - drainStart)
  deps.setConcurrency(tryRecover(deps.getConcurrency(), Date.now()))
}
