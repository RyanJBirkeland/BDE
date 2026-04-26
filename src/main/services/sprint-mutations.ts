/**
 * Sprint mutations — pure data layer operations without side effects.
 *
 * The composition root calls `createSprintMutations(repo)` once at startup.
 * That call binds every exported function to the provided repository instance.
 * There is no module-scope repo singleton; the bound object is the authority.
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
import type { SprintTask, SprintTaskCore, SprintTaskExecution, SprintTaskPR } from '../../shared/types'
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
// Bound mutations object — set by createSprintMutations at startup
// ---------------------------------------------------------------------------

let _bound: SprintMutations | null = null

function getBound(): SprintMutations {
  if (!_bound) throw new Error('[sprint-mutations] Not initialised — call createSprintMutations(repo) before use')
  return _bound
}

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
 * repository instance and installs it as the module-level authority.
 * Call once after `createSprintTaskRepository()` in `index.ts`.
 */
export function createSprintMutations(repo: ISprintTaskRepository): SprintMutations {
  _bound = {
    getTask: (id) => repo.getTask(id),
    listTasks: (options) => repo.listTasks(options),
    listTasksRecent: () => repo.listTasksRecent(),
    getQueueStats: () => repo.getQueueStats(),
    getDoneTodayCount: () => repo.getDoneTodayCount(),
    listTasksWithOpenPrs: () => repo.listTasksWithOpenPrs(),
    getHealthCheckTasks: () => repo.getHealthCheckTasks(),
    getSuccessRateBySpecType: () => repo.getSuccessRateBySpecType(),
    getDailySuccessRate: (days) => repo.getDailySuccessRate(days),
    createTask: (input) => repo.createTask(input),
    claimTask: (id, claimedBy) => repo.claimTask(id, claimedBy),
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
  return _bound
}

// ---------------------------------------------------------------------------
// Free-function exports — delegate to the bound SprintMutations object.
// Consumed by sprint-service.ts (barrel re-export) and legacy call sites.
// ---------------------------------------------------------------------------

export function getTask(id: string): SprintTask | null {
  return getBound().getTask(id)
}

export function listTasks(options?: string | ListTasksOptions): SprintTask[] {
  return getBound().listTasks(options)
}

export function listTasksRecent(): SprintTask[] {
  return getBound().listTasksRecent()
}

export function getQueueStats(): QueueStats {
  return getBound().getQueueStats()
}

export function getDoneTodayCount(): number {
  return getBound().getDoneTodayCount()
}

export function listTasksWithOpenPrs(): SprintTaskPR[] {
  return getBound().listTasksWithOpenPrs()
}

export function getHealthCheckTasks(): SprintTask[] {
  return getBound().getHealthCheckTasks()
}

export function getSuccessRateBySpecType(): SpecTypeSuccessRate[] {
  return getBound().getSuccessRateBySpecType()
}

export function getDailySuccessRate(days?: number): DailySuccessRate[] {
  return getBound().getDailySuccessRate(days)
}

export function createTask(input: CreateTaskInput): Promise<SprintTask | null> {
  return getBound().createTask(input)
}

export function claimTask(id: string, claimedBy: string): Promise<SprintTask | null> {
  return getBound().claimTask(id, claimedBy)
}

export function updateTask(
  id: string,
  patch: Record<string, unknown>,
  options?: UpdateTaskOptions
): Promise<SprintTask | null> {
  return getBound().updateTask(id, patch, options)
}

export function forceUpdateTask(id: string, patch: Record<string, unknown>): Promise<SprintTask | null> {
  return getBound().forceUpdateTask(id, patch)
}

export function deleteTask(id: string): void {
  getBound().deleteTask(id)
}

export function releaseTask(id: string, claimedBy: string): Promise<SprintTask | null> {
  return getBound().releaseTask(id, claimedBy)
}

export function markTaskDoneByPrNumber(prNumber: number): Promise<string[]> {
  return getBound().markTaskDoneByPrNumber(prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): Promise<string[]> {
  return getBound().markTaskCancelledByPrNumber(prNumber)
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): Promise<void> {
  return getBound().updateTaskMergeableState(prNumber, mergeableState)
}

export function flagStuckTasks(): void {
  getBound().flagStuckTasks()
}

export function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): Promise<SprintTask | null> {
  return getBound().createReviewTaskFromAdhoc(input)
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
