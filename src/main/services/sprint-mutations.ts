/**
 * Sprint mutations — pure data layer operations without side effects.
 *
 * These functions delegate to ISprintTaskRepository for data access.
 * They do NOT trigger notifications, broadcasts, or webhooks.
 *
 * For mutation + notification, see sprint-mutation-broadcaster.ts.
 * For the legacy unified interface, see sprint-service.ts.
 */
import {
  getSharedSprintTaskRepository,
  setSharedSprintTaskRepository,
  type ISprintTaskRepository,
  type CreateTaskInput,
  type QueueStats,
  type SpecTypeSuccessRate,
  type DailySuccessRate,
  type ListTasksOptions,
  type UpdateTaskOptions
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

// Explicitly-installed repository instance. The composition root sets this
// once at startup via `setSprintMutationsRepo(repo)`. Before that call the
// accessor falls back to the shared singleton so tests and lazy callers still
// get a working instance without requiring a boot sequence.
let _repo: ISprintTaskRepository | null = null

function getRepo(): ISprintTaskRepository {
  return _repo ?? getSharedSprintTaskRepository()
}

/**
 * Composition-root entry point — installs the repository instance used by
 * every mutation in this module. Call once after `createSprintTaskRepository()`
 * in `index.ts`. Re-exports `setSharedSprintTaskRepository` so both the
 * module-local reference and the shared singleton point to the same instance.
 */
export function setSprintMutationsRepo(instance: ISprintTaskRepository): void {
  _repo = instance
  setSharedSprintTaskRepository(instance)
}

// --- Read operations ---

export function getTask(id: string): SprintTask | null {
  return getRepo().getTask(id)
}

export function listTasks(options?: string | ListTasksOptions): SprintTask[] {
  return getRepo().listTasks(options)
}

export function listTasksRecent(): SprintTask[] {
  return getRepo().listTasksRecent()
}

export function getQueueStats(): QueueStats {
  return getRepo().getQueueStats()
}

export function getDoneTodayCount(): number {
  return getRepo().getDoneTodayCount()
}

export function listTasksWithOpenPrs(): SprintTaskPR[] {
  return getRepo().listTasksWithOpenPrs()
}

export function getHealthCheckTasks(): SprintTaskCore[] {
  return getRepo().getHealthCheckTasks()
}

export function getSuccessRateBySpecType(): SpecTypeSuccessRate[] {
  return getRepo().getSuccessRateBySpecType()
}

export function getDailySuccessRate(days?: number): DailySuccessRate[] {
  return getRepo().getDailySuccessRate(days)
}

// --- Write operations (no notifications) ---

export function createTask(input: CreateTaskInput): Promise<SprintTask | null> {
  return getRepo().createTask(input)
}

export function claimTask(id: string, claimedBy: string): Promise<SprintTaskExecution | null> {
  return getRepo().claimTask(id, claimedBy)
}

export function updateTask(
  id: string,
  patch: Record<string, unknown>,
  options?: UpdateTaskOptions
): Promise<SprintTask | null> {
  return getRepo().updateTask(id, patch, options)
}

export function forceUpdateTask(id: string, patch: Record<string, unknown>): Promise<SprintTask | null> {
  return getRepo().forceUpdateTask(id, patch)
}

export function deleteTask(id: string): void {
  getRepo().deleteTask(id)
}

export function releaseTask(id: string, claimedBy: string): Promise<SprintTask | null> {
  return getRepo().releaseTask(id, claimedBy)
}

export function markTaskDoneByPrNumber(prNumber: number): Promise<string[]> {
  return getRepo().markTaskDoneByPrNumber(prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): Promise<string[]> {
  return getRepo().markTaskCancelledByPrNumber(prNumber)
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): Promise<void> {
  return getRepo().updateTaskMergeableState(prNumber, mergeableState)
}

export function flagStuckTasks(): void {
  const allTasks = getRepo().listTasks()
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
    void getRepo().updateTask(t.id, { needs_review: true })
  }
}

export function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): Promise<SprintTask | null> {
  return getRepo().createReviewTaskFromAdhoc(input)
}
