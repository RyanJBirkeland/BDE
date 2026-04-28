/**
 * Sprint mutations — pure data layer operations without side effects.
 *
 * The composition root calls `createSprintMutations(repo)` once at startup.
 * That call binds every exported function to the provided repository instance
 * and returns the bound object. The caller is responsible for distributing the
 * returned object to consumers; there is no module-scope singleton here.
 *
 * For mutation + notification, see sprint-mutation-broadcaster.ts.
 * For the legacy unified interface, see sprint-service.ts.
 */
import type {
  ISprintTaskRepository,
  CreateTaskInput,
  QueueStats,
  SpecTypeSuccessRate,
  DailySuccessRate,
  ListTasksOptions,
  UpdateTaskOptions
} from '../data/sprint-task-repository'
import type { SprintTask, SprintTaskPR } from '../../shared/types'
import { STUCK_TASK_THRESHOLD_MS } from '../constants'

export type {
  CreateTaskInput,
  QueueStats,
  SpecTypeSuccessRate,
  DailySuccessRate,
  ListTasksOptions,
  UpdateTaskOptions
}

// ---------------------------------------------------------------------------
// SprintMutations interface
// ---------------------------------------------------------------------------

export interface SprintMutations {
  getTask(id: string): SprintTask | null
  listTasks(options?: string | ListTasksOptions): SprintTask[]
  listTasksRecent(): SprintTask[]
  getQueueStats(): QueueStats
  getDoneTodayCount(): number
  listTasksWithOpenPrs(): SprintTaskPR[]
  getHealthCheckTasks(): SprintTask[]
  getSuccessRateBySpecType(): SpecTypeSuccessRate[]
  getDailySuccessRate(days?: number): DailySuccessRate[]
  createTask(input: CreateTaskInput): Promise<SprintTask | null>
  claimTask(id: string, claimedBy: string): Promise<SprintTask | null>
  updateTask(id: string, patch: Record<string, unknown>, options?: UpdateTaskOptions): Promise<SprintTask | null>
  forceUpdateTask(id: string, patch: Record<string, unknown>): Promise<SprintTask | null>
  deleteTask(id: string): void
  releaseTask(id: string, claimedBy: string): Promise<SprintTask | null>
  markTaskDoneByPrNumber(prNumber: number): Promise<string[]>
  markTaskCancelledByPrNumber(prNumber: number): Promise<string[]>
  updateTaskMergeableState(prNumber: number, mergeableState: string | null): Promise<void>
  flagStuckTasks(): void
  createReviewTaskFromAdhoc(input: {
    title: string
    repo: string
    spec: string
    worktreePath: string
    branch: string
  }): Promise<SprintTask | null>
}

/**
 * Composition-root entry point — binds every sprint mutation to the given
 * repository instance and returns the bound object.
 * Call once after `createSprintTaskRepository()` in `index.ts`.
 * The returned object is the sole authority — do not discard it.
 */
export function createSprintMutations(repo: ISprintTaskRepository): SprintMutations {
  return {
    getTask: (id) => repo.getTask(id),
    listTasks: (options) => repo.listTasks(options),
    listTasksRecent: () => repo.listTasksRecent(),
    getQueueStats: () => repo.getQueueStats(),
    getDoneTodayCount: () => repo.getDoneTodayCount(),
    listTasksWithOpenPrs: () => repo.listTasksWithOpenPrs(),
    getHealthCheckTasks: () => repo.getHealthCheckTasks() as SprintTask[],
    getSuccessRateBySpecType: () => repo.getSuccessRateBySpecType(),
    getDailySuccessRate: (days) => repo.getDailySuccessRate(days),
    createTask: (input) => repo.createTask(input),
    claimTask: (id, claimedBy) => repo.claimTask(id, claimedBy) as Promise<SprintTask | null>,
    updateTask: (id, patch, options) => repo.updateTask(id, patch, options),
    forceUpdateTask: (id, patch) => repo.forceUpdateTask(id, patch),
    deleteTask: (id) => repo.deleteTask(id),
    releaseTask: (id, claimedBy) => repo.releaseTask(id, claimedBy),
    markTaskDoneByPrNumber: (prNumber) => repo.markTaskDoneByPrNumber(prNumber),
    markTaskCancelledByPrNumber: (prNumber) => repo.markTaskCancelledByPrNumber(prNumber),
    updateTaskMergeableState: (prNumber, mergeableState) => repo.updateTaskMergeableState(prNumber, mergeableState),
    flagStuckTasks: () => flagStuckTasksUsing(repo),
    createReviewTaskFromAdhoc: (input) => repo.createReviewTaskFromAdhoc(input)
  }
}

// ---------------------------------------------------------------------------
// Private implementation
// ---------------------------------------------------------------------------

function flagStuckTasksUsing(repo: ISprintTaskRepository): void {
  const allTasks = repo.listTasks()
  const oneHourAgo = Date.now() - STUCK_TASK_THRESHOLD_MS
  const stuck = allTasks.filter(
    (t) =>
      // Note: Uses ['error', 'failed'] instead of isFailure() from task-state-machine
      // because cancelled tasks are intentionally excluded from stuck-task flagging.
      ['error', 'failed'].includes(t.status) &&
      !t.needs_review &&
      new Date(t.updated_at).getTime() < oneHourAgo
  )
  for (const t of stuck) {
    // fire-and-forget: flagging is best-effort, failures are logged by the data layer
    void repo.updateTask(t.id, { needs_review: true })
  }
}
