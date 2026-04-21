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
  createSprintTaskRepository,
  type ISprintTaskRepository,
  type CreateTaskInput,
  type QueueStats,
  type SpecTypeSuccessRate,
  type DailySuccessRate,
  type ListTasksOptions,
  type UpdateTaskOptions
} from '../data/sprint-task-repository'
import type { SprintTask, SprintTaskPR } from '../../shared/types'
import { STUCK_TASK_THRESHOLD_MS } from '../constants'

export type { CreateTaskInput, QueueStats, SpecTypeSuccessRate, DailySuccessRate, ListTasksOptions, UpdateTaskOptions }

const repo: ISprintTaskRepository = createSprintTaskRepository()

// --- Read operations ---

export function getTask(id: string): SprintTask | null {
  return repo.getTask(id)
}

export function listTasks(options?: string | ListTasksOptions): SprintTask[] {
  return repo.listTasks(options)
}

export function listTasksRecent(): SprintTask[] {
  return repo.listTasksRecent()
}

export function getQueueStats(): QueueStats {
  return repo.getQueueStats()
}

export function getDoneTodayCount(): number {
  return repo.getDoneTodayCount()
}

export function listTasksWithOpenPrs(): SprintTaskPR[] {
  return repo.listTasksWithOpenPrs()
}

export function getHealthCheckTasks(): SprintTask[] {
  return repo.getHealthCheckTasks()
}

export function getSuccessRateBySpecType(): SpecTypeSuccessRate[] {
  return repo.getSuccessRateBySpecType()
}

export function getDailySuccessRate(days?: number): DailySuccessRate[] {
  return repo.getDailySuccessRate(days)
}

// --- Write operations (no notifications) ---

export function createTask(input: CreateTaskInput): SprintTask | null {
  return repo.createTask(input)
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  return repo.claimTask(id, claimedBy)
}

export function updateTask(
  id: string,
  patch: Record<string, unknown>,
  options?: UpdateTaskOptions
): SprintTask | null {
  return repo.updateTask(id, patch, options)
}

export function forceUpdateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  return repo.forceUpdateTask(id, patch)
}

export function deleteTask(id: string): void {
  repo.deleteTask(id)
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  return repo.releaseTask(id, claimedBy)
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  return repo.markTaskDoneByPrNumber(prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  return repo.markTaskCancelledByPrNumber(prNumber)
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  repo.updateTaskMergeableState(prNumber, mergeableState)
}

export function flagStuckTasks(): void {
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
  if (stuck.length > 0) {
    for (const t of stuck) {
      repo.updateTask(t.id, { needs_review: true })
    }
  }
}

export function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): SprintTask | null {
  return repo.createReviewTaskFromAdhoc(input)
}
