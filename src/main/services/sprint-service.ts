/**
 * Sprint service layer — thin wrappers around sprint-queries that
 * add mutation notifications (SSE broadcast + IPC push).
 *
 * Extracted from handlers/sprint-local.ts so that both IPC handlers
 * and Queue API can share the same notification-aware data access
 * without importing from the handler module.
 */
import { notifySprintMutation } from '../handlers/sprint-listeners'
import {
  getTask as _getTask,
  listTasks as _listTasks,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  claimTask as _claimTask,
  releaseTask as _releaseTask,
  getQueueStats as _getQueueStats,
  getDoneTodayCount as _getDoneTodayCount,
  markTaskDoneByPrNumber as _markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber as _markTaskCancelledByPrNumber,
  listTasksWithOpenPrs as _listTasksWithOpenPrs,
  updateTaskMergeableState as _updateTaskMergeableState,
  getHealthCheckTasks as _getHealthCheckTasks,
  UPDATE_ALLOWLIST
} from '../data/sprint-queries'
import type { CreateTaskInput, QueueStats } from '../data/sprint-queries'
import type { SprintTask } from '../../shared/types'

export { UPDATE_ALLOWLIST }
export type { CreateTaskInput, QueueStats }

export function getTask(id: string): SprintTask | null {
  return _getTask(id)
}

export function listTasks(status?: string): SprintTask[] {
  return _listTasks(status)
}

export function createTask(input: CreateTaskInput): SprintTask | null {
  const row = _createTask(input)
  if (row) notifySprintMutation('created', row)
  return row
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  const result = _claimTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const result = _updateTask(id, patch)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function deleteTask(id: string): void {
  const task = _getTask(id)
  _deleteTask(id)
  if (task) notifySprintMutation('deleted', task)
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  const result = _releaseTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function getQueueStats(): QueueStats {
  return _getQueueStats()
}

export function getDoneTodayCount(): number {
  return _getDoneTodayCount()
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  return _markTaskDoneByPrNumber(prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  return _markTaskCancelledByPrNumber(prNumber)
}

export function listTasksWithOpenPrs(): SprintTask[] {
  return _listTasksWithOpenPrs()
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  _updateTaskMergeableState(prNumber, mergeableState)
}

export function getHealthCheckTasks(): ReturnType<typeof _getHealthCheckTasks> {
  return _getHealthCheckTasks()
}
