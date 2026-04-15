/**
 * Drain loop — polling orchestration that claims queued tasks and spawns agents.
 *
 * Exported as pure functions so they can be unit-tested without a live
 * AgentManagerImpl instance. The class delegates to these functions via a
 * `DrainLoopDeps` struct injected at call sites.
 */

import type { Logger } from '../logger'
import type { AgentManagerConfig, ActiveAgent } from './types'
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

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

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
  processQueuedTask: (
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>
  ) => Promise<void>
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
      deps.logger.error(`[agent-manager] Dep-index full rebuild failed — falling back to incremental refresh: ${err}`)
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
  const queued = deps.repo.getQueuedTasks(limit) as unknown as Array<Record<string, unknown>>
  deps.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
  for (const raw of queued) {
    if (deps.isShuttingDown()) break
    if (availableSlots(deps.getConcurrency(), deps.activeAgents.size + deps.getPendingSpawns()) <= 0) {
      deps.logger.info('[agent-manager] No slots available — stopping drain iteration')
      break
    }
    try {
      await deps.processQueuedTask(raw, taskStatusMap)
    } catch (err) {
      deps.logger.error(
        `[agent-manager] Failed to process task ${(raw as Record<string, unknown>).id}: ${err}`
      )
    }
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
