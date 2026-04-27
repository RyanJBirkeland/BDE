/**
 * Sprint use cases — orchestration functions that compose mutations,
 * validation, and side effects into single business operations.
 *
 * Each function here corresponds to one user-visible action (cancel task,
 * create task with validation, update from UI, reset for retry). They sit
 * above the mutation layer and below the IPC handlers.
 *
 * `sprint-service.ts` re-exports everything from here for backward compatibility.
 * New callers should import directly from this module.
 *
 * NOTE: This module does NOT import from `sprint-service.ts` to avoid circular
 * dependencies. Functions that need broadcaster-wrapped mutations (e.g. the
 * `deps.updateTask` default in `cancelTask`) receive them as injectable deps.
 * `createTaskWithValidation` and `updateTaskFromUi` accept an optional
 * `createTask` / `updateTask` dep so callers can wire broadcaster-wrapped
 * versions; the base defaults go to `sprint-mutations` directly.
 */
import * as mutations from './sprint-mutations'
import type { SprintTask } from '../../shared/types'
import { validateTaskCreation } from './task-validation'
import { SpecParser } from './spec-quality/spec-parser'
import { RequiredSectionsValidator } from './spec-quality/validators/sync-validators'
import { getRepoPaths } from '../paths'
import { listGroups } from '../data/task-group-queries'
import type { Logger } from '../logger'
import {
  TASK_STATUSES,
  isTaskStatus
} from '../../shared/task-state-machine'
import type { TaskStatus } from '../../shared/task-state-machine'
import { isValidTaskId } from '../lib/validation'
import { UPDATE_ALLOWLIST } from '../data/sprint-maintenance-facade'
import { validateAndFilterPatch } from '../lib/patch-validation'
import { prepareQueueTransition, type TaskStateService } from './task-state-service'
import { sleep } from '../lib/async-utils'
import { DISPATCH_RETRY_DELAY_MS } from '../lib/retry-constants'

// ============================================================================
// cancelTask
// ============================================================================

/**
 * Discriminated union returned by `cancelTask()`.
 *
 * - `{ row: SprintTask; sideEffectFailed: false }` — cancel succeeded and
 *   `onStatusTerminal` ran cleanly.
 * - `{ row: SprintTask; sideEffectFailed: true; sideEffectError: Error }` —
 *   cancel succeeded in the DB but `onStatusTerminal` failed after retries.
 *   Dependent tasks may remain stuck in `blocked`.
 * - `{ row: null }` — task was not found.
 */
export type CancelTaskResult =
  | { row: SprintTask; sideEffectFailed: false }
  | { row: SprintTask; sideEffectFailed: true; sideEffectError: Error }
  | { row: null }

export interface CancelTaskDeps {
  /** Fires task-terminal resolution so dependents unblock. */
  onStatusTerminal: (taskId: string, status: TaskStatus) => Promise<void> | void
  logger: Logger
  /**
   * Optional override for the underlying update call (tests inject a spy;
   * production callers inject the broadcaster-wrapped `updateTask` from
   * `sprint-service.ts`). Defaults to the bare mutations layer.
   */
  updateTask?: (
    id: string,
    patch: Record<string, unknown>,
    options?: mutations.UpdateTaskOptions
  ) => Promise<SprintTask | null>
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
 *
 * Returns a `CancelTaskResult` discriminated union:
 * - `{ row: null }` — task not found.
 * - `{ row, sideEffectFailed: false }` — clean cancel.
 * - `{ row, sideEffectFailed: true, sideEffectError }` — cancel committed but
 *   `onStatusTerminal` failed after retries; dependents may need manual unblock.
 */
export async function cancelTask(
  id: string,
  opts: { reason?: string } & CancelTaskOptions,
  deps: CancelTaskDeps
): Promise<CancelTaskResult> {
  const patch: Record<string, unknown> = { status: 'cancelled' }
  if (opts.reason) patch.notes = opts.reason
  const doUpdate = deps.updateTask ?? mutations.updateTask
  const updateOptions = opts.caller ? { caller: opts.caller } : undefined
  let row: SprintTask | null
  try {
    row = await doUpdate(id, patch, updateOptions)
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
  if (!row) {
    return { row: null }
  }

  return dispatchCancelWithRetry(id, row, deps)
}

async function dispatchCancelWithRetry(
  id: string,
  row: SprintTask,
  deps: CancelTaskDeps
): Promise<CancelTaskResult> {
  const doUpdate = deps.updateTask ?? mutations.updateTask

  try {
    await deps.onStatusTerminal(id, 'cancelled')
    return { row, sideEffectFailed: false }
  } catch (firstError) {
    deps.logger.warn(`onStatusTerminal after cancel ${id} (attempt 1), retrying in ${DISPATCH_RETRY_DELAY_MS}ms: ${firstError}`)
  }

  await sleep(DISPATCH_RETRY_DELAY_MS)

  try {
    await deps.onStatusTerminal(id, 'cancelled')
    return { row, sideEffectFailed: false }
  } catch (secondError) {
    const sideEffectError = secondError instanceof Error ? secondError : new Error(String(secondError))
    deps.logger.error(`onStatusTerminal after cancel ${id} (attempt 2, giving up): ${sideEffectError}`)
    appendCancelFailureAnnotation(id, row, new Date().toISOString(), doUpdate)
    return { row, sideEffectFailed: true, sideEffectError }
  }
}

function appendCancelFailureAnnotation(
  id: string,
  row: SprintTask,
  timestamp: string,
  doUpdate: (id: string, patch: Record<string, unknown>, options?: mutations.UpdateTaskOptions) => Promise<SprintTask | null>
): void {
  const existingNotes = typeof row.notes === 'string' ? row.notes : null
  const annotation = `[terminal-dispatch-failed ${timestamp}] Dependency resolution may not have run. Dependents may need manual unblock.`
  const updatedNotes = existingNotes ? `${existingNotes}\n${annotation}` : annotation
  // fire-and-forget: best-effort annotation, failures are logged by the data layer
  void doUpdate(id, { notes: updatedNotes })
}

// ============================================================================
// resetTaskForRetry
// ============================================================================

export interface ResetTaskForRetryDeps {
  updateTask?: (id: string, patch: Record<string, unknown>) => Promise<SprintTask | null>
}

/**
 * Clear stale terminal-state fields on a task so it looks fresh after
 * re-queueing. Does NOT set `status` — the caller owns that decision
 * (usually 'queued', sometimes 'backlog'). Fields cleared:
 * - completed_at, failure_reason, claimed_by, started_at
 * - retry_count and fast_fail_count (reset to 0, not null)
 * - next_eligible_at
 */
export function resetTaskForRetry(id: string, deps: ResetTaskForRetryDeps = {}): Promise<SprintTask | null> {
  const doUpdate = deps.updateTask ?? mutations.updateTask
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

// ============================================================================
// createTaskWithValidation
// ============================================================================

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
  /**
   * Task creation function to call after validation. Defaults to the bare
   * mutations layer; production callers inject the broadcaster-wrapped version
   * from `sprint-service.ts` so the renderer gets notified.
   */
  createTask?: (input: mutations.CreateTaskInput) => Promise<SprintTask | null>
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
export async function createTaskWithValidation(
  input: mutations.CreateTaskInput,
  deps: CreateTaskWithValidationDeps,
  opts: CreateTaskWithValidationOpts = {}
): Promise<SprintTask> {
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

  const doCreate = deps.createTask ?? mutations.createTask
  const row = await doCreate(validatedTask)
  if (!row) throw new Error('Failed to create task')
  return row
}

// ============================================================================
// updateTaskFromUi
// ============================================================================

export interface UpdateTaskFromUiDeps {
  logger: Logger
  taskStateService: TaskStateService
  /**
   * Plain field update function used when no status change is involved.
   * Defaults to the bare mutations layer; production callers inject the
   * broadcaster-wrapped version from `sprint-service.ts`.
   */
  updateTask?: (
    id: string,
    patch: Record<string, unknown>,
    options?: mutations.UpdateTaskOptions
  ) => Promise<SprintTask | null>
}

/**
 * Apply an IPC-originated task patch with the full UI safety pipeline:
 * id check, allowlist filtering, status narrowing, queued-transition policy
 * (spec quality + dependency auto-block), and delegated status write via
 * `TaskStateService.transition()` for any status change.
 *
 * Replaces the inline business logic that used to live in
 * `sprint-local.ts:sprintUpdateHandler`. Handlers now delegate here.
 */
export async function updateTaskFromUi(
  id: string,
  patch: Record<string, unknown>,
  deps: UpdateTaskFromUiDeps
): Promise<SprintTask | null> {
  if (!isValidTaskId(id)) throw new Error('Invalid task ID format')

  const filtered = validateAndFilterPatch(patch, UPDATE_ALLOWLIST)
  if (filtered === null) throw new Error('No valid fields to update')
  let workingPatch = filtered

  const validatedStatus = narrowStatus(workingPatch.status)

  if (validatedStatus === 'queued') {
    // prepareQueueTransition may redirect to 'blocked' if hard deps unsatisfied.
    // The returned patch contains the final status + any additional fields.
    const { patch: finalPatch } = await prepareQueueTransition(id, workingPatch, {
      logger: deps.logger
    })
    workingPatch = finalPatch
  }

  if (workingPatch.status !== undefined) {
    // Status is changing — route through TaskStateService for validation + terminal dispatch.
    const finalStatus = narrowStatus(workingPatch.status)
    if (!finalStatus) throw new Error('Status narrowing failed unexpectedly')
    const { status: _dropped, ...nonStatusFields } = workingPatch
    await deps.taskStateService.transition(id, finalStatus, {
      fields: nonStatusFields,
      caller: 'ui'
    })
    // Return the updated task so callers get the full row as before.
    return mutations.getTask(id)
  }

  // No status change — plain field update, no transition logic needed.
  const doUpdate = deps.updateTask ?? mutations.updateTask
  return doUpdate(id, workingPatch)
}

function narrowStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !isTaskStatus(value)) {
    throw new Error(
      `Invalid status "${String(value)}". Valid statuses: ${TASK_STATUSES.join(', ')}`
    )
  }
  return value
}
