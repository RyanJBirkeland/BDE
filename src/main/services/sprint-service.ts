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
import { validateTaskCreation } from './task-validation'
import { SpecParser } from './spec-quality/spec-parser'
import { RequiredSectionsValidator } from './spec-quality/validators/sync-validators'
import { getRepoPaths } from '../git'
import { listGroups } from '../data/task-group-queries'
import type { Logger } from '../logger'

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

export function updateTask(
  id: string,
  patch: Record<string, unknown>,
  options?: mutations.UpdateTaskOptions
): SprintTask | null {
  const result = mutations.updateTask(id, patch, options)
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

export interface CancelTaskDeps {
  /** Fires task-terminal resolution so dependents unblock. */
  onStatusTerminal: (taskId: string, status: string) => Promise<void> | void
  logger: Logger
  /**
   * Optional override for the underlying update call (tests inject a spy).
   * Defaults to this module's `updateTask` which wraps the broadcaster.
   */
  updateTask?: (
    id: string,
    patch: Record<string, unknown>,
    options?: mutations.UpdateTaskOptions
  ) => SprintTask | null
}

export interface CancelTaskOptions {
  /**
   * Attribution for the audit trail — forwarded to `updateTask` as the
   * `changed_by` value. Lets MCP-originated cancels surface as
   * `'mcp'` / `'mcp:<client>'` instead of `'unknown'`. Optional; the
   * default `'unknown'` preserves existing behaviour for callers that
   * do not specify.
   */
  caller?: string
}

/**
 * Raised when a caller attempts a status change the state machine forbids
 * (e.g. cancelling an already-`done` task). Lets MCP/IPC adapters branch on
 * the error kind without regex-matching the underlying data-layer message.
 */
export class TaskTransitionError extends Error {
  readonly taskId: string
  readonly fromStatus: string | null
  readonly toStatus: string

  constructor(
    message: string,
    ctx: { taskId: string; fromStatus: string | null; toStatus: string }
  ) {
    super(message)
    this.name = 'TaskTransitionError'
    this.taskId = ctx.taskId
    this.fromStatus = ctx.fromStatus
    this.toStatus = ctx.toStatus
  }
}

function isInvalidTransitionError(err: unknown): err is Error {
  return err instanceof Error && err.message.includes('Invalid transition')
}

/**
 * Cancel a task — sets status to 'cancelled' with an optional reason in
 * notes, then awaits the terminal-status handler so dependents unblock.
 *
 * Consolidates the update-then-terminal two-step so the MCP server and
 * future IPC paths don't re-implement it in drift-prone closures.
 *
 * Throws `TaskTransitionError` when the current status forbids cancellation
 * (e.g. already `done`). Unknown errors propagate unchanged.
 */
export async function cancelTask(
  id: string,
  opts: { reason?: string } & CancelTaskOptions,
  deps: CancelTaskDeps
): Promise<SprintTask | null> {
  const patch: Record<string, unknown> = { status: 'cancelled' }
  if (opts.reason) patch.notes = opts.reason
  const doUpdate = deps.updateTask ?? updateTask
  const updateOptions = opts.caller ? { caller: opts.caller } : undefined
  let row: SprintTask | null
  try {
    row = doUpdate(id, patch, updateOptions)
  } catch (err) {
    if (isInvalidTransitionError(err)) {
      const current = mutations.getTask(id)
      throw new TaskTransitionError(err.message, {
        taskId: id,
        fromStatus: current?.status ?? null,
        toStatus: 'cancelled'
      })
    }
    throw err
  }
  if (row) {
    try {
      await deps.onStatusTerminal(id, 'cancelled')
    } catch (err) {
      deps.logger.error(`onStatusTerminal after cancel ${id}: ${err}`)
    }
  }
  return row
}

export interface ResetTaskForRetryDeps {
  updateTask?: (id: string, patch: Record<string, unknown>) => SprintTask | null
}

/**
 * Clear stale terminal-state fields on a task so it looks fresh after
 * re-queueing. Does NOT set `status` — the caller owns that decision
 * (usually 'queued', sometimes 'backlog'). Fields cleared:
 * - completed_at, failure_reason, claimed_by, started_at
 * - retry_count and fast_fail_count (reset to 0, not null)
 * - next_eligible_at
 */
export function resetTaskForRetry(id: string, deps: ResetTaskForRetryDeps = {}): SprintTask | null {
  const doUpdate = deps.updateTask ?? updateTask
  return doUpdate(id, {
    completed_at: null,
    failure_reason: null,
    claimed_by: null,
    started_at: null,
    retry_count: 0,
    fast_fail_count: 0,
    next_eligible_at: null
  })
}

export type TaskValidationCode = 'spec-structural' | 'spec-readiness' | 'repo-not-configured'

/**
 * Machine-readable validation failure raised by `createTaskWithValidation`.
 * `code` lets MCP clients and IPC handlers branch on failure kind without
 * parsing the human-readable message.
 */
export class TaskValidationError extends Error {
  readonly code: TaskValidationCode
  constructor(code: TaskValidationCode, message: string) {
    super(message)
    this.code = code
    this.name = 'TaskValidationError'
  }
}

export interface CreateTaskWithValidationDeps {
  logger: Logger
}

export interface CreateTaskWithValidationOpts {
  /**
   * Skip the spec-structure check (required headings, min length) that
   * runs for queued tasks. Structural validation (required fields,
   * configured repo) always runs. Intended for batch/admin flows with
   * hand-validated specs; logged at warn level when true.
   */
  skipReadinessCheck?: boolean
}

/** Shared task-creation entry point for the sprint:create IPC handler and the MCP server. */
export function createTaskWithValidation(
  input: mutations.CreateTaskInput,
  deps: CreateTaskWithValidationDeps,
  opts: CreateTaskWithValidationOpts = {}
): SprintTask {
  const validationInput = opts.skipReadinessCheck ? { ...input, status: 'backlog' as const } : input
  const validation = validateTaskCreation(validationInput, {
    logger: { warn: (msg) => deps.logger.warn(msg as string) },
    listTasks: mutations.listTasks,
    listGroups
  })
  if (!validation.valid) {
    throw new TaskValidationError(
      'spec-structural',
      `Spec quality checks failed: ${validation.errors.join('; ')}`
    )
  }

  // Restore caller's intended status (validateStructural only controls spec-length gating).
  const validatedTask = opts.skipReadinessCheck
    ? { ...validation.task, status: input.status ?? validation.task.status }
    : validation.task

  if (!opts.skipReadinessCheck && validatedTask.status === 'queued' && validatedTask.spec) {
    const parsed = new SpecParser().parse(validatedTask.spec)
    const sectionErrors = new RequiredSectionsValidator()
      .validate(parsed)
      .filter((issue) => issue.severity === 'error')
    if (sectionErrors.length > 0 && sectionErrors[0]) {
      throw new TaskValidationError(
        'spec-readiness',
        `Spec quality checks failed: ${sectionErrors[0].message}`
      )
    }
  }

  if (opts.skipReadinessCheck) {
    deps.logger.warn('createTaskWithValidation: skipReadinessCheck=true (batch/admin path)')
  }

  const repoPaths = getRepoPaths()
  if (!repoPaths[validatedTask.repo]) {
    throw new TaskValidationError(
      'repo-not-configured',
      `Repo "${validatedTask.repo}" is not configured. Add it in Settings > Repositories, then try again.`
    )
  }

  const row = createTask(validatedTask)
  if (!row) throw new Error('Failed to create task')
  return row
}
