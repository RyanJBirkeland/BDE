/**
 * Sprint service layer — thin wrappers around the sprint task repository that
 * add mutation notifications (SSE broadcast + IPC push).
 *
 * Extracted from handlers/sprint-local.ts so that both IPC handlers
 * and Queue API can share the same notification-aware data access
 * without importing from the handler module.
 *
 * All data access goes through ISprintTaskRepository (createSprintTaskRepository).
 * No direct imports from sprint-queries — the repository is the single abstraction.
 */
import { notifySprintMutation } from '../handlers/sprint-listeners'
import {
  createSprintTaskRepository,
  type ISprintTaskRepository,
  type CreateTaskInput,
  type QueueStats,
  type SpecTypeSuccessRate
} from '../data/sprint-task-repository'
import { UPDATE_ALLOWLIST } from '../data/sprint-queries'
import type { SprintTask } from '../../shared/types'

export { UPDATE_ALLOWLIST }
export type { CreateTaskInput, QueueStats, SpecTypeSuccessRate }

const repo: ISprintTaskRepository = createSprintTaskRepository()

export function getTask(id: string): SprintTask | null {
  return repo.getTask(id)
}

export function listTasks(status?: string): SprintTask[] {
  return repo.listTasks(status)
}

export function listTasksRecent(): SprintTask[] {
  return repo.listTasksRecent()
}

export function createTask(input: CreateTaskInput): SprintTask | null {
  const row = repo.createTask(input)
  if (row) notifySprintMutation('created', row)
  return row
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  const result = repo.claimTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const result = repo.updateTask(id, patch)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function deleteTask(id: string): void {
  const task = repo.getTask(id)
  repo.deleteTask(id)
  if (task) notifySprintMutation('deleted', task)
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  const result = repo.releaseTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function getQueueStats(): QueueStats {
  return repo.getQueueStats()
}

export function getDoneTodayCount(): number {
  return repo.getDoneTodayCount()
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  return repo.markTaskDoneByPrNumber(prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  return repo.markTaskCancelledByPrNumber(prNumber)
}

export function listTasksWithOpenPrs(): SprintTask[] {
  return repo.listTasksWithOpenPrs()
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  repo.updateTaskMergeableState(prNumber, mergeableState)
}

export function getHealthCheckTasks(): SprintTask[] {
  return repo.getHealthCheckTasks()
}

export function getSuccessRateBySpecType(): SpecTypeSuccessRate[] {
  return repo.getSuccessRateBySpecType()
}
