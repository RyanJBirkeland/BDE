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
import type {
  SprintTask,
  SprintTaskCore,
  SprintTaskExecution,
  SprintTaskPR,
  TaskDependency,
  TaskGroup,
  EpicDependency
} from '../../shared/types'
import * as queries from './sprint-queries'
import * as reportingQueries from './reporting-queries'
import * as groupQueries from './task-group-queries'
import type { CreateTaskInput, QueueStats } from './sprint-queries'
import type { ListTasksOptions, UpdateTaskOptions } from './sprint-task-crud'
import type {
  SpecTypeSuccessRate,
  DailySuccessRate,
  FailureReasonBreakdown
} from './reporting-queries'

export type {
  CreateTaskInput,
  QueueStats,
  SpecTypeSuccessRate,
  DailySuccessRate,
  FailureReasonBreakdown,
  ListTasksOptions,
  UpdateTaskOptions
}

/**
 * Methods used by the agent manager for pipeline execution.
 */
export interface IAgentTaskRepository {
  getTask(id: string): SprintTask | null
  /**
   * Mutate a task. `options.caller` is recorded as the `changed_by`
   * attribution in the `task_changes` audit trail (defaults to
   * `'unknown'` when omitted, which historical call sites rely on).
   */
  updateTask(
    id: string,
    patch: Record<string, unknown>,
    options?: UpdateTaskOptions
  ): Promise<SprintTask | null>
  getQueuedTasks(limit: number): SprintTask[]
  getTasksWithDependencies(): Array<{
    id: string
    depends_on: TaskDependency[] | null
    status: string
  }>
  getOrphanedTasks(claimedBy: string): SprintTask[]
  clearStaleClaimedBy(claimedBy: string): number
  getActiveTaskCount(): number
  claimTask(id: string, claimedBy: string, maxActive?: number): Promise<SprintTaskExecution | null>
  getGroup(id: string): TaskGroup | null
  getGroupTasks(groupId: string): SprintTask[]
  getGroupsWithDependencies(): Array<{ id: string; depends_on: EpicDependency[] | null }>
  /** Used by the drain loop to report queue depth in drain-paused broadcasts. */
  getQueueStats(): QueueStats
}

/**
 * Methods used by the sprint PR poller for tracking GitHub PR status.
 */
export interface ISprintPollerRepository {
  markTaskDoneByPrNumber(prNumber: number): Promise<string[]>
  markTaskCancelledByPrNumber(prNumber: number): Promise<string[]>
  listTasksWithOpenPrs(): SprintTaskPR[]
  updateTaskMergeableState(prNumber: number, mergeableState: string | null): Promise<void>
}

/**
 * Methods used by IPC handlers, dashboard, and status server.
 */
export interface IDashboardRepository {
  /**
   * List sprint tasks, optionally filtered and paginated. Accepts the legacy
   * bare-status string for backward compatibility with existing callers, or
   * a `ListTasksOptions` object when a caller needs repo/epic/tag/search
   * filters or pagination pushed into SQL.
   */
  listTasks(options?: string | ListTasksOptions): SprintTask[]
  listTasksRecent(): SprintTask[]
  createTask(input: CreateTaskInput): Promise<SprintTask | null>
  deleteTask(id: string, deletedBy?: string): void
  releaseTask(id: string, claimedBy: string): Promise<SprintTask | null>
  getQueueStats(): QueueStats
  getDoneTodayCount(): number
  getHealthCheckTasks(): SprintTaskCore[]
  getSuccessRateBySpecType(): SpecTypeSuccessRate[]
  createReviewTaskFromAdhoc(input: {
    title: string
    repo: string
    spec: string
    worktreePath: string
    branch: string
  }): Promise<SprintTask | null>
  getDailySuccessRate(days?: number): DailySuccessRate[]
  getFailureReasonBreakdown(): FailureReasonBreakdown[]
  /**
   * Operator escape-hatch — writes a terminal status without running the
   * state-machine transition check. Used only by manual-override handlers
   * (sprint:forceFailTask / sprint:forceDoneTask).
   */
  forceUpdateTask(id: string, patch: Record<string, unknown>): Promise<SprintTask | null>
}

/**
 * Complete repository interface — extends all domain-specific sub-interfaces.
 * Provides backward compatibility for callers that need the full surface.
 */
export interface ISprintTaskRepository
  extends IAgentTaskRepository, ISprintPollerRepository, IDashboardRepository {}

/**
 * Lazily-cached `ISprintTaskRepository` shared by every consumer that does not
 * have one wired in via constructor injection. Centralises object identity so
 * the audit's "DI seam defeated by per-module singletons" finding stays fixed.
 *
 * The composition root may install a custom instance via
 * `setSharedSprintTaskRepository()`; tests can reset it via the underscored
 * helper.
 */
let _sharedRepo: ISprintTaskRepository | null = null

export function getSharedSprintTaskRepository(): ISprintTaskRepository {
  if (!_sharedRepo) _sharedRepo = createSprintTaskRepository()
  return _sharedRepo
}

export function setSharedSprintTaskRepository(repo: ISprintTaskRepository): void {
  _sharedRepo = repo
}

/** Test-only — drop the shared instance so the next access lazily rebuilds it. */
export function _resetSharedSprintTaskRepository(): void {
  _sharedRepo = null
}

/**
 * Concrete implementation that delegates to sprint-queries functions.
 * This is the only place that imports sprint-queries directly.
 */
export function createSprintTaskRepository(): ISprintTaskRepository {
  return {
    getTask: queries.getTask,
    updateTask: (id, patch, options) => queries.updateTask(id, patch, options),
    getQueuedTasks: queries.getQueuedTasks,
    getTasksWithDependencies: queries.getTasksWithDependencies,
    getOrphanedTasks: queries.getOrphanedTasks,
    clearStaleClaimedBy: queries.clearStaleClaimedBy,
    getActiveTaskCount: queries.getActiveTaskCount,
    claimTask: (id, claimedBy, maxActive) => queries.claimTask(id, claimedBy, maxActive),
    getGroup: groupQueries.getGroup,
    getGroupTasks: groupQueries.getGroupTasks,
    getGroupsWithDependencies: groupQueries.getGroupsWithDependencies,
    listTasks: (options) => queries.listTasks(options),
    listTasksRecent: queries.listTasksRecent,
    createTask: queries.createTask,
    deleteTask: queries.deleteTask,
    releaseTask: queries.releaseTask,
    getQueueStats: queries.getQueueStats,
    getDoneTodayCount: reportingQueries.getDoneTodayCount,
    markTaskDoneByPrNumber: queries.markTaskDoneByPrNumber,
    markTaskCancelledByPrNumber: queries.markTaskCancelledByPrNumber,
    listTasksWithOpenPrs: queries.listTasksWithOpenPrs,
    updateTaskMergeableState: queries.updateTaskMergeableState,
    getHealthCheckTasks: queries.getHealthCheckTasks,
    getSuccessRateBySpecType: reportingQueries.getSuccessRateBySpecType,
    createReviewTaskFromAdhoc: queries.createReviewTaskFromAdhoc,
    getDailySuccessRate: reportingQueries.getDailySuccessRate,
    getFailureReasonBreakdown: reportingQueries.getFailureReasonBreakdown,
    forceUpdateTask: queries.forceUpdateTask
  }
}
