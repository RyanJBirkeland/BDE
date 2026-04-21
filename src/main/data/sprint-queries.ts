/**
 * Sprint task query functions — SQLite edition.
 * This file is a barrel re-export. All implementations live in focused modules.
 * Import from this file for backward compatibility — zero import-site changes needed.
 */

// Reporting queries
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

// Logger infrastructure
export { setSprintQueriesLogger, withErrorLogging } from './sprint-query-logger'

// Row mapper
export { mapRowToTask, mapRowsToTasks } from './sprint-task-mapper'

// Types and constants
export { UPDATE_ALLOWLIST, COLUMN_MAP } from './sprint-task-types'
export type { QueueStats, CreateTaskInput } from './sprint-task-types'

// CRUD operations
export {
  getTask,
  listTasks,
  listTasksRecent,
  createTask,
  createReviewTaskFromAdhoc,
  updateTask,
  forceUpdateTask,
  deleteTask
} from './sprint-task-crud'
export type { ListTasksOptions } from './sprint-task-crud'

// Queue and concurrency operations
export { claimTask, releaseTask, getQueuedTasks, getActiveTaskCount } from './sprint-queue-ops'

// PR lifecycle operations
export {
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState
} from './sprint-pr-ops'

// Agent health and dependency queries
export {
  getQueueStats,
  getOrphanedTasks,
  clearStaleClaimedBy,
  clearSprintTaskFk,
  getHealthCheckTasks,
  getAllTaskIds,
  getTasksWithDependencies
} from './sprint-agent-queries'

// Snapshot maintenance
export { DIFF_SNAPSHOT_RETENTION_DAYS, pruneOldDiffSnapshots } from './sprint-maintenance'
