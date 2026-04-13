/**
 * Sprint task query functions — SQLite edition.
 * This module is now a facade that re-exports from domain-specific modules.
 *
 * Migrated from a 1100+ line god object to separate concerns:
 * - sprint-task-crud.ts — CRUD operations
 * - sprint-queue-stats.ts — queue metrics and dashboard queries
 * - sprint-pr-sync.ts — GitHub PR tracking
 * - sprint-snapshot-management.ts — diff snapshot cleanup
 * - reporting-queries.ts — analytics and metrics
 */
import type { Logger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { setCrudLogger } from './sprint-task-crud'
import { setQueueStatsLogger } from './sprint-queue-stats'
import { setPrSyncLogger } from './sprint-pr-sync'

// Re-export CRUD operations
export {
  getTask,
  listTasks,
  listTasksRecent,
  createTask,
  createReviewTaskFromAdhoc,
  updateTask,
  deleteTask,
  claimTask,
  releaseTask,
  getAllTaskIds,
  getTasksWithDependencies,
  getOrphanedTasks,
  clearSprintTaskFk,
  mapRowToTask,
  mapRowsToTasks,
  UPDATE_ALLOWLIST,
  COLUMN_MAP
} from './sprint-task-crud'
export type { CreateTaskInput } from './sprint-task-crud'

// Re-export queue stats
export {
  getQueueStats,
  getActiveTaskCount,
  getQueuedTasks,
  getHealthCheckTasks
} from './sprint-queue-stats'
export type { QueueStats } from './sprint-queue-stats'

// Re-export PR sync operations
export {
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState
} from './sprint-pr-sync'

// Re-export snapshot management
export { pruneOldDiffSnapshots, DIFF_SNAPSHOT_RETENTION_DAYS } from './sprint-snapshot-management'

// Re-export reporting functions and types for backward compatibility
export {
  getDoneTodayCount,
  getFailureReasonBreakdown,
  getTaskRuntimeStats,
  getSuccessRateBySpecType,
  getDailySuccessRate
} from './reporting-queries'
export type {
  FailureReasonBreakdown,
  TaskRuntimeStats,
  SpecTypeSuccessRate,
  DailySuccessRate
} from './reporting-queries'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

/**
 * Set logger for all sprint query modules.
 * Propagates to CRUD, queue stats, and PR sync modules.
 */
export function setSprintQueriesLogger(l: Logger): void {
  logger = l
  setCrudLogger(l)
  setQueueStatsLogger(l)
  setPrSyncLogger(l)
}

/**
 * Error handling wrapper for query operations.
 * Logs errors with operation context and returns fallback value.
 * Extracted from repetitive try-catch patterns — exported for future use.
 */
export function withErrorLogging<T>(operation: () => T, fallback: T, operationName: string): T {
  try {
    return operation()
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-queries] ${operationName} failed: ${msg}`)
    return fallback
  }
}
