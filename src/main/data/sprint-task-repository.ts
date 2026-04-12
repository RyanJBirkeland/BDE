/**
 * Abstract interface for sprint task data access.
 * Allows the agent manager to be tested with mock implementations
 * instead of module-level vi.mock() on sprint-queries.
 *
 * This is the single data access abstraction for all sprint task operations.
 * IPC handlers (sprint-local.ts) access data through the sprint-service, which
 * delegates to this repository. The agent manager uses this interface directly
 * for dependency injection in tests.
 */
import type { SprintTask, TaskDependency } from '../../shared/types'
import * as queries from './sprint-queries'
import type {
  CreateTaskInput,
  QueueStats,
  SpecTypeSuccessRate,
  DailySuccessRate,
  FailureReasonBreakdown
} from './sprint-queries'

export type { CreateTaskInput, QueueStats, SpecTypeSuccessRate, DailySuccessRate, FailureReasonBreakdown }

// Re-export constants and functions for callers that need them
export { UPDATE_ALLOWLIST } from './sprint-queries'
export { pruneOldDiffSnapshots, DIFF_SNAPSHOT_RETENTION_DAYS } from './sprint-queries'
export { clearSprintTaskFk } from './sprint-queries'
export { getFailureReasonBreakdown } from './sprint-queries'

/**
 * Methods used by the agent manager for pipeline execution.
 */
export interface IAgentTaskRepository {
  getTask(id: string): SprintTask | null
  updateTask(id: string, patch: Record<string, unknown>): SprintTask | null
  getQueuedTasks(limit: number): SprintTask[]
  getTasksWithDependencies(): Array<{
    id: string
    depends_on: TaskDependency[] | null
    status: string
  }>
  getOrphanedTasks(claimedBy: string): SprintTask[]
  getActiveTaskCount(): number
  claimTask(id: string, claimedBy: string): SprintTask | null
}

/**
 * Methods used by the sprint PR poller for tracking GitHub PR status.
 */
export interface ISprintPollerRepository {
  markTaskDoneByPrNumber(prNumber: number): string[]
  markTaskCancelledByPrNumber(prNumber: number): string[]
  listTasksWithOpenPrs(): SprintTask[]
  updateTaskMergeableState(prNumber: number, mergeableState: string | null): void
}

/**
 * Methods used by IPC handlers, dashboard, and status server.
 */
export interface IDashboardRepository {
  listTasks(status?: string): SprintTask[]
  listTasksRecent(): SprintTask[]
  createTask(input: CreateTaskInput): SprintTask | null
  deleteTask(id: string, deletedBy?: string): void
  releaseTask(id: string, claimedBy: string): SprintTask | null
  getQueueStats(): QueueStats
  getDoneTodayCount(): number
  getHealthCheckTasks(): SprintTask[]
  getSuccessRateBySpecType(): SpecTypeSuccessRate[]
  createReviewTaskFromAdhoc(input: {
    title: string
    repo: string
    spec: string
    worktreePath: string
    branch: string
  }): SprintTask | null
  getDailySuccessRate(days?: number): DailySuccessRate[]
  getFailureReasonBreakdown(): FailureReasonBreakdown[]
}

/**
 * Complete repository interface — extends all domain-specific sub-interfaces.
 * Provides backward compatibility for callers that need the full surface.
 */
export interface ISprintTaskRepository
  extends IAgentTaskRepository, ISprintPollerRepository, IDashboardRepository {}

/**
 * Concrete implementation that delegates to sprint-queries functions.
 * This is the only place that imports sprint-queries directly.
 */
export function createSprintTaskRepository(): ISprintTaskRepository {
  return {
    getTask: queries.getTask,
    updateTask: queries.updateTask,
    getQueuedTasks: queries.getQueuedTasks,
    getTasksWithDependencies: queries.getTasksWithDependencies,
    getOrphanedTasks: queries.getOrphanedTasks,
    getActiveTaskCount: queries.getActiveTaskCount,
    claimTask: queries.claimTask,
    listTasks: queries.listTasks,
    listTasksRecent: queries.listTasksRecent,
    createTask: queries.createTask,
    deleteTask: queries.deleteTask,
    releaseTask: queries.releaseTask,
    getQueueStats: queries.getQueueStats,
    getDoneTodayCount: queries.getDoneTodayCount,
    markTaskDoneByPrNumber: queries.markTaskDoneByPrNumber,
    markTaskCancelledByPrNumber: queries.markTaskCancelledByPrNumber,
    listTasksWithOpenPrs: queries.listTasksWithOpenPrs,
    updateTaskMergeableState: queries.updateTaskMergeableState,
    getHealthCheckTasks: queries.getHealthCheckTasks,
    getSuccessRateBySpecType: queries.getSuccessRateBySpecType,
    createReviewTaskFromAdhoc: queries.createReviewTaskFromAdhoc,
    getDailySuccessRate: queries.getDailySuccessRate,
    getFailureReasonBreakdown: queries.getFailureReasonBreakdown
  }
}
