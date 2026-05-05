/**
 * Canonical task state machine — single source of truth for task lifecycle.
 *
 * This module consolidates:
 * - Status type and constants
 * - Terminal/failure/satisfaction predicates
 * - Valid state transitions
 *
 * UI rendering metadata (buckets, colors, icons) lives in renderer layer at
 * src/renderer/src/lib/task-status-ui.ts
 *
 * Created by D1a as the foundation for D1b/c/d migration.
 */

/**
 * Task status union — all 10 possible states.
 */
export type TaskStatus =
  | 'backlog'
  | 'queued'
  | 'blocked'
  | 'active'
  | 'review'
  | 'approved'
  | 'done'
  | 'cancelled'
  | 'failed'
  | 'error'

/**
 * All task statuses in a principled order (lifecycle progression).
 *
 * Typed as a readonly tuple of literals (no widening annotation) so
 * consumers like Zod can preserve the 9-literal union via `z.enum(...)`.
 */
export const TASK_STATUSES = [
  'backlog',
  'queued',
  'blocked',
  'active',
  'review',
  'approved',
  'done',
  'cancelled',
  'failed',
  'error'
] as const satisfies readonly TaskStatus[]

/**
 * Terminal statuses — task has reached end of lifecycle.
 * No further automatic transitions occur.
 */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'done',
  'cancelled',
  'failed',
  'error'
])

/**
 * Statuses that trigger dependency resolution — terminal statuses plus `approved`,
 * which satisfies hard deps without being fully terminal.
 * Use this set instead of TERMINAL_STATUSES when deciding whether to unblock
 * downstream tasks, so approved tasks release their dependents immediately.
 */
export const DEPENDENCY_TRIGGER_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  ...TERMINAL_STATUSES,
  'approved'
])

/**
 * Failure statuses — task did not complete successfully.
 * Subset of terminal statuses.
 */
export const FAILURE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'failed',
  'error',
  'cancelled'
])

/**
 * Statuses that satisfy hard dependencies.
 * Both 'done' and 'approved' unblock downstream tasks with hard dependencies.
 * 'approved' satisfies deps without being terminal — the PR is blessed and
 * downstream tasks may begin while the merge is still pending.
 */
export const HARD_SATISFIED_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'done',
  'approved'
])

/**
 * Valid state transitions — adjacency list representation.
 *
 * TS enforces exhaustiveness; add a new status here whenever TASK_STATUSES grows.
 * The `Record<TaskStatus, ...>` type makes missing entries a compile error.
 *
 * Each terminal failure state (`cancelled`, `failed`, `error`) allows a manual
 * `→ done` transition. A human who implements the work outside the pipeline
 * (or determines the failure was spurious) needs a clean way to mark the task
 * resolved without raw SQLite — the escape hatch lives in the state machine
 * rather than as a backdoor in the data layer.
 */
export const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  backlog: new Set<TaskStatus>(['queued', 'blocked', 'cancelled']),
  // 'done' is permitted for the auto-complete path: agent-manager detected that
  // matching work already landed on origin/main out-of-band (prior run, manual
  // commit, cherry-pick). This is not the normal pipeline completion path —
  // TerminalDispatcher still fires so dependency resolution and metrics run.
  // 'failed' and 'error' added for two edge cases:
  // 1. Terminal retry exhaustion while the task is in 'queued' (orphan race set it back before
  //    the spawned agent finished) — resolveFailure needs queued→failed to land.
  // 2. Orphan recovery at cap (orphan_recovery_count=3) on a queued task — needs queued→error.
  // 'backlog' is the pre-flight "move back to holding" path: drain-loop showed the user a
  // missing-toolchain/env-var dialog and they chose not to proceed yet (issue #708).
  queued: new Set<TaskStatus>(['active', 'blocked', 'backlog', 'cancelled', 'done', 'failed', 'error']),
  blocked: new Set<TaskStatus>(['queued', 'cancelled']),
  active: new Set<TaskStatus>(['review', 'done', 'failed', 'error', 'cancelled', 'queued']),
  review: new Set<TaskStatus>(['queued', 'done', 'cancelled', 'failed', 'approved']),
  // 'approved' is a human-blessed state: code reviewed and accepted, waiting to ship.
  // Satisfies hard dependencies so downstream tasks can unblock before merge.
  // Not terminal — the Sprint PR Poller drives approved → done when the PR merges.
  approved: new Set<TaskStatus>(['done', 'queued', 'cancelled', 'failed']),
  done: new Set<TaskStatus>(['cancelled']),
  failed: new Set<TaskStatus>(['queued', 'cancelled', 'done']),
  error: new Set<TaskStatus>(['queued', 'cancelled', 'done']),
  // 'backlog' and 'queued' allow cancelled tasks to be revived in place — the MCP
  // TERMINAL_STATE_RESET_PATCH clears stale runtime fields on any terminal→queued/backlog
  // transition. Without these, the only escape from cancelled is marking done (issue #708).
  cancelled: new Set<TaskStatus>(['done', 'backlog', 'queued'])
}

/**
 * Check if a transition from one status to another is valid.
 *
 * Accepts `TaskStatus` parameters. Callers that hold an unvalidated string
 * (e.g. from a database row or wire payload) must narrow to `TaskStatus`
 * first — typically via `isTaskStatus()` or a Zod parse — before calling.
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.has(to)
}

/**
 * Check if a status is terminal (end of lifecycle).
 */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Check if a status represents a failure.
 */
export function isFailure(status: TaskStatus): boolean {
  return FAILURE_STATUSES.has(status)
}

/**
 * Check if a status satisfies hard dependencies.
 * Only 'done' returns true; all other statuses return false.
 */
export function isHardSatisfied(status: TaskStatus): boolean {
  return HARD_SATISFIED_STATUSES.has(status)
}

/**
 * Type guard: narrows a `string` to `TaskStatus`.
 *
 * Use at trust boundaries (DB rows, IPC payloads, external input) before
 * calling the narrowed predicates above.
 */
export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}

/**
 * Validation result for a status transition.
 */
export type ValidationResult = { ok: true } | { ok: false; reason: string }

/**
 * Validates whether a status transition is allowed by the state machine.
 *
 * @param currentStatus - The task's current status
 * @param targetStatus - The desired new status
 * @returns Validation result with descriptive error reason on failure
 *
 * @example
 * const result = validateTransition('active', 'done')
 * if (!result.ok) {
 *   logger.warn(result.reason)
 *   return null
 * }
 */
export function validateTransition(
  currentStatus: TaskStatus,
  targetStatus: TaskStatus
): ValidationResult {
  if (!isValidTransition(currentStatus, targetStatus)) {
    const allowed = VALID_TRANSITIONS[currentStatus]
    const allowedArray = allowed ? Array.from(allowed) : []
    const allowedList = allowedArray.length > 0 ? allowedArray.join(', ') : 'none'
    return {
      ok: false,
      reason: `Invalid transition: ${currentStatus} → ${targetStatus}. Allowed: ${allowedList}`
    }
  }
  return { ok: true }
}
