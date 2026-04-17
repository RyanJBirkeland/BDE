/**
 * Sprint service — backward-compatible unified interface.
 *
 * Re-exports from sprint-mutations.ts and sprint-mutation-broadcaster.ts
 * to maintain existing import paths. New code should import from those
 * modules directly.
 *
 * This module wraps mutation operations to automatically trigger notifications,
 * preserving the behavior existing code expects.
 */
import * as mutations from './sprint-mutations'
import * as broadcaster from './sprint-mutation-broadcaster'
import type { SprintTask } from '../../shared/types'

export type {
  CreateTaskInput,
  QueueStats,
  SpecTypeSuccessRate,
  DailySuccessRate
} from './sprint-mutations'

export type { SprintMutationEvent, SprintMutationListener } from './sprint-mutation-broadcaster'

// Re-export notification functions
export const onSprintMutation = broadcaster.onSprintMutation
export const notifySprintMutation = broadcaster.notifySprintMutation

// Re-export read-only operations
export const getTask = mutations.getTask
export const listTasks = mutations.listTasks
export const listTasksRecent = mutations.listTasksRecent
export const getQueueStats = mutations.getQueueStats
export const getDoneTodayCount = mutations.getDoneTodayCount
export const listTasksWithOpenPrs = mutations.listTasksWithOpenPrs
export const getHealthCheckTasks = mutations.getHealthCheckTasks
export const getSuccessRateBySpecType = mutations.getSuccessRateBySpecType
export const getDailySuccessRate = mutations.getDailySuccessRate
export const markTaskDoneByPrNumber = mutations.markTaskDoneByPrNumber
export const markTaskCancelledByPrNumber = mutations.markTaskCancelledByPrNumber
export const updateTaskMergeableState = mutations.updateTaskMergeableState
export const flagStuckTasks = mutations.flagStuckTasks

// Wrap mutation operations to auto-notify
export function createTask(input: mutations.CreateTaskInput): SprintTask | null {
  const row = mutations.createTask(input)
  if (row) broadcaster.notifySprintMutation('created', row)
  return row
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  const result = mutations.claimTask(id, claimedBy)
  if (result) broadcaster.notifySprintMutation('updated', result)
  return result
}

export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const result = mutations.updateTask(id, patch)
  if (result) broadcaster.notifySprintMutation('updated', result)
  return result
}

/**
 * Manual operator override — writes a terminal status bypassing the state machine.
 * See `forceUpdateTask` in sprint-task-crud for rationale.
 */
export function forceUpdateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const result = mutations.forceUpdateTask(id, patch)
  if (result) broadcaster.notifySprintMutation('updated', result)
  return result
}

export function deleteTask(id: string): void {
  const task = mutations.getTask(id)
  mutations.deleteTask(id)
  if (task) broadcaster.notifySprintMutation('deleted', task)
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  const result = mutations.releaseTask(id, claimedBy)
  if (result) broadcaster.notifySprintMutation('updated', result)
  return result
}

export function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): SprintTask | null {
  const row = mutations.createReviewTaskFromAdhoc(input)
  if (row) broadcaster.notifySprintMutation('created', row)
  return row
}
