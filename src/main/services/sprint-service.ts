/**
 * Sprint service — backward-compatible unified interface.
 *
 * This module is a barrel re-export. It exists to keep existing import paths
 * working without changes. New code should import from the focused modules:
 *
 * - Data / mutations:  `sprint-mutations.ts`
 * - Notifications:     `sprint-mutation-broadcaster.ts`
 * - Orchestration:     `sprint-use-cases.ts`
 *
 * The broadcaster-wrapped mutation wrappers (`createTask`, `updateTask`, etc.)
 * still live here because they combine two concerns that callers currently
 * treat as a single operation. They may be moved to `sprint-use-cases.ts`
 * in a future cleanup.
 */
import * as mutations from './sprint-mutations'
import * as broadcaster from './sprint-mutation-broadcaster'
import type { SprintTask, SprintTaskExecution, ClaimedTask, TaskTemplate } from '../../shared/types'
import { getSettingJson } from '../settings'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import type { TaskStateService } from './task-state-service'
import { execFileAsync } from '../lib/async-utils'
import { getErrorMessage } from '../../shared/errors'
import { createLogger } from '../logger'

const logger = createLogger('sprint-service')

export type {
  CreateTaskInput,
  QueueStats,
  SpecTypeSuccessRate,
  DailySuccessRate,
  ListTasksOptions,
  UpdateTaskOptions
} from './sprint-mutations'

export type { SprintMutationEvent, SprintMutationListener } from './sprint-mutation-broadcaster'

// Re-export notification functions
export const onSprintMutation = broadcaster.onSprintMutation
export const notifySprintMutation = broadcaster.notifySprintMutation

// Re-export read-only operations
export const getTask = mutations.getTask
export const listTasks = mutations.listTasks
// Audit trail read — exposed through the service layer so adapters (MCP,
// handlers) never reach past it into the data layer directly.
export { getTaskChanges } from '../data/task-changes'
export type { TaskChange, GetTaskChangesOptions } from '../data/task-changes'
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
export async function createTask(input: mutations.CreateTaskInput): Promise<SprintTask | null> {
  const row = await mutations.createTask(input)
  if (row) broadcaster.notifySprintMutation('created', row)
  return row
}

export async function claimTask(id: string, claimedBy: string): Promise<SprintTaskExecution | null> {
  const result = await mutations.claimTask(id, claimedBy)
  // Broadcaster expects SprintTask (full shape) — the value IS a full task at runtime;
  // the narrowed declared type is a contract hint, not a runtime shape change.
  if (result) broadcaster.notifySprintMutation('updated', result as SprintTask)
  return result
}

export async function updateTask(
  id: string,
  patch: Record<string, unknown>,
  options?: mutations.UpdateTaskOptions
): Promise<SprintTask | null> {
  const result = await mutations.updateTask(id, patch, options)
  if (result) broadcaster.notifySprintMutation('updated', result)
  return result
}

/**
 * Manual operator override — writes a terminal status bypassing the state machine.
 * See `forceUpdateTask` in sprint-task-crud for rationale.
 */
export async function forceUpdateTask(
  id: string,
  patch: Record<string, unknown>
): Promise<SprintTask | null> {
  const result = await mutations.forceUpdateTask(id, patch)
  if (result) broadcaster.notifySprintMutation('updated', result)
  return result
}

export function deleteTask(id: string): void {
  const task = mutations.getTask(id)
  mutations.deleteTask(id)
  if (task) broadcaster.notifySprintMutation('deleted', task)
}

export async function releaseTask(id: string, claimedBy: string): Promise<SprintTask | null> {
  const result = await mutations.releaseTask(id, claimedBy)
  if (result) broadcaster.notifySprintMutation('updated', result)
  return result
}

export async function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): Promise<SprintTask | null> {
  const row = await mutations.createReviewTaskFromAdhoc(input)
  if (row) broadcaster.notifySprintMutation('created', row)
  return row
}

// Re-export use-case orchestration from the focused module.
export {
  cancelTask,
  resetTaskForRetry,
  updateTaskFromUi,
  TaskTransitionError,
  TaskValidationError,
} from './sprint-use-cases'

export type {
  CancelTaskDeps,
  CancelTaskOptions,
  ResetTaskForRetryDeps,
  CreateTaskWithValidationDeps,
  CreateTaskWithValidationOpts,
  UpdateTaskFromUiDeps,
  TaskValidationCode,
} from './sprint-use-cases'

import {
  createTaskWithValidation as _createTaskWithValidation,
  resetTaskForRetry as _resetTaskForRetry,
  type CreateTaskWithValidationDeps,
  type CreateTaskWithValidationOpts,
} from './sprint-use-cases'

/**
 * Broadcaster-wired variant of `createTaskWithValidation`. Injects the
 * broadcaster-wrapped `createTask` so the renderer is notified on success.
 * Callers that need raw (no-broadcast) creation should use
 * `sprint-use-cases.createTaskWithValidation` directly with an explicit dep.
 */
export function createTaskWithValidation(
  input: mutations.CreateTaskInput,
  deps: CreateTaskWithValidationDeps,
  opts?: CreateTaskWithValidationOpts
): Promise<SprintTask> {
  return _createTaskWithValidation(input, { ...deps, createTask }, opts)
}

export function buildClaimedTask(taskId: string): ClaimedTask | null {
  const task = mutations.getTask(taskId)
  if (!task) return null

  let templatePromptPrefix: string | null = null
  if (task.template_name) {
    const templates = getSettingJson<TaskTemplate[]>('task.templates') ?? [...DEFAULT_TASK_TEMPLATES]
    const match = templates.find((t) => t.name === task.template_name)
    templatePromptPrefix = match?.promptPrefix ?? null
  }

  return { ...task, templatePromptPrefix }
}

export type ForceReleaseClaimDeps = {
  cancelAgent?: (id: string) => Promise<void>
  taskStateService: TaskStateService
}

export async function forceReleaseClaim(
  taskId: string,
  deps: ForceReleaseClaimDeps
): Promise<SprintTask> {
  const task = mutations.getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'active') {
    throw new Error(
      `Cannot force-release a task with status ${task.status} — only active tasks can be released`
    )
  }
  await deps.cancelAgent?.(taskId)
  await _resetTaskForRetry(taskId)
  await deps.taskStateService.transition(taskId, 'queued', {
    fields: { notes: null, agent_run_id: null },
    caller: 'sprint:forceReleaseClaim'
  })
  const released = mutations.getTask(taskId)
  if (!released) throw new Error(`Failed to release task ${taskId}`)
  broadcaster.notifySprintMutation('updated', released)
  return released
}

export async function retryTask(taskId: string): Promise<SprintTask> {
  const task = mutations.getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'failed' && task.status !== 'error' && task.status !== 'cancelled') {
    throw new Error(`Cannot retry task with status ${task.status}`)
  }

  const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')
  const repoConfig = repos?.find((r) => r.name === task.repo)
  const repoPath = repoConfig?.localPath

  if (repoPath) {
    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath })
      const { stdout: branches } = await execFileAsync(
        'git',
        ['branch', '--list', `agent/${slug}*`],
        { cwd: repoPath }
      )
      for (const branch of branches
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean)) {
        await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath }).catch((err) => {
          logger.warn(`retryTask: failed to delete branch ${branch}: ${getErrorMessage(err)}`)
        })
      }
    } catch {
      /* cleanup is best-effort */
    }
  }

  await _resetTaskForRetry(taskId)
  const updated = await mutations.updateTask(taskId, {
    status: 'queued',
    notes: null,
    agent_run_id: null
  })
  if (!updated) throw new Error(`Failed to update task ${taskId}`)
  broadcaster.notifySprintMutation('updated', updated)
  return updated
}
