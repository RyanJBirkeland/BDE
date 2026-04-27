/**
 * TaskStateService — centralized sprint task status transition service.
 *
 * Single entry point for all `sprint_tasks.status` writes. Owns:
 *  - State-machine validation (isValidTransition)
 *  - DB write delegation (via ISprintTaskRepository)
 *  - Post-terminal dispatch (via TerminalDispatcher port)
 *
 * Also contains:
 *  - Queue transition business rules (prepareQueueTransition, prepareUnblockTransition)
 *  - Operator escape-hatches (forceTerminalOverride)
 *
 * Re-exports validateTransition from shared for callers that need it.
 */

import type { Logger } from '../logger'
import { buildBlockedNotes, computeBlockState } from './dependency-service'
import { validateTaskSpec } from './spec-quality/index'
import { getTask, listTasks, updateTask, forceUpdateTask } from './sprint-mutations'
import { listGroups } from '../data/task-group-queries'
import {
  isValidTransition,
  isTerminal,
  isTaskStatus,
  TERMINAL_STATUSES
} from '../../shared/task-state-machine'
import type { TaskStatus } from '../../shared/task-state-machine'
import { nowIso } from '../../shared/time'
import { sleep } from '../lib/async-utils'
import { DISPATCH_RETRY_DELAY_MS } from '../lib/retry-constants'

export type { ValidationResult } from '../../shared/task-state-machine'
export { validateTransition } from '../../shared/task-state-machine'

// ---- TransitionResult -------------------------------------------------------

/**
 * Returned by `TaskStateService.transition()` to distinguish a clean
 * success from a committed-but-degraded outcome where the DB write
 * succeeded but `TerminalDispatcher.dispatch` failed after retries.
 *
 * `dependentsResolved: false` means dispatch failed — dependent tasks
 * may remain stuck in `blocked` and require manual intervention.
 * `dispatchError` carries the error from the second (final) attempt.
 */
export interface TransitionResult {
  committed: true
  dependentsResolved: boolean
  dispatchError?: Error
}

// ---- TerminalDispatcher port -----------------------------------------------

/**
 * Port implemented by each terminal-handling strategy (agent-manager path
 * and PR-poller / manual path). `TaskStateService` calls `dispatch` after
 * every terminal DB write; neither strategy is invoked directly anymore.
 */
export interface TerminalDispatcher {
  dispatch(taskId: string, status: TaskStatus): void | Promise<void>
}

// ---- InvalidTransitionError ------------------------------------------------

/**
 * Raised when a transition is not permitted by the state machine.
 * Carries structured context so adapters can branch without message-parsing.
 */
export class InvalidTransitionError extends Error {
  readonly taskId: string
  readonly fromStatus: TaskStatus
  readonly toStatus: TaskStatus

  constructor(taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus) {
    super(
      `[TaskStateService] Invalid transition for task ${taskId}: ${fromStatus} → ${toStatus}`
    )
    this.name = 'InvalidTransitionError'
    this.taskId = taskId
    this.fromStatus = fromStatus
    this.toStatus = toStatus
  }
}

// ---- TaskStateService -------------------------------------------------------

export interface TaskStateServiceDeps {
  terminalDispatcher: TerminalDispatcher
  logger: Logger
}

/**
 * Centralized owner of all `sprint_tasks.status` writes.
 *
 * Callers pass the desired `targetStatus` plus any additional patch fields
 * in `ctx.fields`. The service validates the transition, delegates the DB
 * write to `updateTask` (which records the audit trail and broadcasts the
 * file-watcher event), then calls `TerminalDispatcher.dispatch` when the
 * target is a terminal status.
 */
export class TaskStateService {
  private readonly terminalDispatcher: TerminalDispatcher
  private readonly logger: Logger

  constructor(deps: TaskStateServiceDeps) {
    this.terminalDispatcher = deps.terminalDispatcher
    this.logger = deps.logger
  }

  async transition(
    taskId: string,
    targetStatus: TaskStatus,
    ctx: { fields?: Record<string, unknown>; caller?: string } = {}
  ): Promise<TransitionResult> {
    const currentTask = getTask(taskId)
    if (!currentTask) {
      throw new Error(`[TaskStateService] Task ${taskId} not found`)
    }

    const currentStatus = currentTask.status
    if (!isTaskStatus(currentStatus)) {
      throw new Error(
        `[TaskStateService] Task ${taskId} has unrecognised status: ${currentStatus}`
      )
    }

    if (!isValidTransition(currentStatus, targetStatus)) {
      throw new InvalidTransitionError(taskId, currentStatus, targetStatus)
    }

    const patch: Record<string, unknown> = { status: targetStatus, ...ctx.fields }
    const callerAttribution = ctx.caller ?? 'task-state-service'
    updateTask(taskId, patch, { caller: callerAttribution })
    this.logger.info(
      `[task-state] task ${taskId}: ${currentStatus} → ${targetStatus} (caller=${callerAttribution})`
    )

    if (!isTerminal(targetStatus)) {
      return { committed: true, dependentsResolved: true }
    }

    return this.dispatchTerminalWithRetry(taskId, targetStatus)
  }

  private async dispatchTerminalWithRetry(
    taskId: string,
    status: TaskStatus
  ): Promise<TransitionResult> {
    try {
      await this.terminalDispatcher.dispatch(taskId, status)
      return { committed: true, dependentsResolved: true }
    } catch (firstError) {
      this.logger.warn(
        `[TaskStateService] dispatch failed for ${taskId} (attempt 1), retrying in ${DISPATCH_RETRY_DELAY_MS}ms: ${firstError}`
      )
    }

    await sleep(DISPATCH_RETRY_DELAY_MS)

    try {
      await this.terminalDispatcher.dispatch(taskId, status)
      return { committed: true, dependentsResolved: true }
    } catch (secondError) {
      const dispatchError = secondError instanceof Error ? secondError : new Error(String(secondError))
      this.logger.error(
        `[TaskStateService] dispatch failed for ${taskId} (attempt 2, giving up): ${dispatchError}`
      )
      appendDispatchFailureAnnotation(taskId, new Date().toISOString())
      return { committed: true, dependentsResolved: false, dispatchError }
    }
  }
}

/**
 * Factory for a `TaskStateService` instance.
 * Used by the composition root to wire the two dispatcher strategies.
 */
export function createTaskStateService(deps: TaskStateServiceDeps): TaskStateService {
  return new TaskStateService(deps)
}

/**
 * Appends a structured, timestamped warning to the task's `notes` field.
 * Called when `TerminalDispatcher.dispatch` fails on both attempts so the
 * degradation is visible in the UI and audit trail without a new IPC channel.
 * Appends (never replaces) so existing notes survive.
 */
function appendDispatchFailureAnnotation(taskId: string, timestamp: string): void {
  const task = getTask(taskId)
  const existingNotes = typeof task?.notes === 'string' ? task.notes : null
  const annotation = `[terminal-dispatch-failed ${timestamp}] Dependency resolution may not have run. Dependents may need manual unblock.`
  const updatedNotes = existingNotes ? `${existingNotes}\n${annotation}` : annotation
  updateTask(taskId, { notes: updatedNotes })
}

// ---- Types ----------------------------------------------------------------

export interface QueueTransitionDeps {
  logger: Logger
}

export interface QueueTransitionResult {
  /** The final patch to apply — may have status changed to 'blocked' */
  patch: Record<string, unknown>
  /** True if the task was auto-blocked due to unsatisfied dependencies */
  wasBlocked: boolean
}

// ---- Core business rule ---------------------------------------------------

/**
 * Prepares the final patch for a task being transitioned to `queued`.
 *
 * Enforces three queuing business rules in order:
 *  1. Spec quality — throws if the spec fails structural/semantic checks
 *  2. Dependency blocking — silently changes status to `blocked` if hard
 *     deps are unsatisfied (callers can inspect `wasBlocked` to log)
 *  3. Review flag reset — clears `needs_review` so agents start fresh
 *
 * Called exclusively when `patch.status === 'queued'`.
 * Returns the (possibly mutated) patch the caller should pass to updateTask.
 */
export async function prepareQueueTransition(
  taskId: string,
  incomingPatch: Record<string, unknown>,
  deps: QueueTransitionDeps
): Promise<QueueTransitionResult> {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  // Rule 1: Spec quality — throws on failure, aborting the transition
  const specText = (incomingPatch.spec as string) ?? task.spec ?? null
  await validateTaskSpec({ title: task.title, repo: task.repo, spec: specText, context: 'queue' })

  // Rule 2: Dependency auto-blocking — redirect to blocked if hard deps unsatisfied
  const { shouldBlock, blockedBy } = computeBlockState(task, {
    logger: deps.logger,
    listTasks,
    listGroups
  })
  if (shouldBlock) {
    return {
      patch: {
        ...incomingPatch,
        status: 'blocked',
        notes: buildBlockedNotes(blockedBy, task.notes as string | null)
      },
      wasBlocked: true
    }
  }

  // Rule 3: Clear review flag — fresh attempt, reset human-flagged state
  return { patch: { ...incomingPatch, needs_review: false }, wasBlocked: false }
}

/**
 * Validates that a blocked task is ready to be manually unblocked.
 * Throws if the task is missing or not blocked, or if spec fails quality checks.
 * Returns the task so callers don't need to re-fetch it.
 */
export async function prepareUnblockTransition(taskId: string): Promise<void> {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'blocked')
    throw new Error(`Task ${taskId} is not blocked (status: ${task.status})`)

  await validateTaskSpec({
    title: task.title,
    repo: task.repo,
    spec: task.spec ?? null,
    context: 'unblock'
  })
}

// ---- Operator escape-hatches ---------------------------------------------

export type ForceTerminalStatus = 'failed' | 'done'

export interface ForceTerminalOverrideArgs {
  taskId: string
  reason?: string | undefined
  force?: boolean | undefined
  targetStatus: ForceTerminalStatus
}

export interface ForceTerminalOverrideDeps {
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
}

/**
 * Force a task into a terminal status (`failed` or `done`) without running the
 * state-machine transition check. The handler-layer wrapper validates the task
 * id; this function owns the policy: refuse already-terminal tasks unless the
 * caller passes `force: true`, build the patch, persist via `forceUpdateTask`,
 * and notify dependents.
 */
export function forceTerminalOverride(
  args: ForceTerminalOverrideArgs,
  deps: ForceTerminalOverrideDeps
): { ok: true } {
  const task = getTask(args.taskId)
  if (!task) throw new Error(`Task ${args.taskId} not found`)

  if (TERMINAL_STATUSES.has(task.status) && !args.force) {
    throw new Error(
      `Task ${args.taskId} is already terminal (${task.status}). Pass force: true to override.`
    )
  }

  const patch = buildForceTerminalPatch(args.targetStatus, args.reason)
  const updated = forceUpdateTask(args.taskId, patch)
  if (!updated) throw new Error(`Failed to force ${args.targetStatus} on task ${args.taskId}`)

  deps.onStatusTerminal(args.taskId, args.targetStatus)
  return { ok: true }
}

function buildForceTerminalPatch(
  targetStatus: ForceTerminalStatus,
  reason: string | undefined
): Record<string, unknown> {
  const timestamp = nowIso()
  if (targetStatus === 'failed') {
    const trimmedReason = reason?.trim() || 'manual-override'
    return {
      status: 'failed',
      failure_reason: 'unknown',
      notes: `Marked failed manually by user at ${timestamp}. reason: ${trimmedReason}`
    }
  }
  return {
    status: 'done',
    completed_at: timestamp,
    failure_reason: null,
    notes: `Marked done manually by user at ${timestamp}.`
  }
}
