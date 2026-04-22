/**
 * TaskStateService — business logic for task state transitions.
 *
 * This module owns the rules for *what happens* when a task changes state.
 * The data layer (sprint-queries) owns *how* the change is persisted.
 * IPC handlers (sprint-local) own *when* to call these rules.
 *
 * Extracted from sprint-local.ts:sprint:update, where queuing rules
 * were mixed directly into the IPC handler.
 *
 * Re-exports validateTransition from shared for callers that need it.
 */

import type { Logger } from '../logger'
import { buildBlockedNotes, computeBlockState } from './dependency-service'
import { validateTaskSpec } from './spec-quality/index'
import { getTask, listTasks } from './sprint-mutations'
import { listGroups } from '../data/task-group-queries'

export type { ValidationResult } from '../../shared/task-state-machine'
export { validateTransition } from '../../shared/task-state-machine'

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

import { TERMINAL_STATUSES } from '../../shared/task-state-machine'
import { nowIso } from '../../shared/time'
import type { TaskStatus } from '../../shared/task-state-machine'
import { forceUpdateTask } from './sprint-mutations'

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
