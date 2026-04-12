/**
 * Canonical task state machine — single source of truth for task lifecycle.
 *
 * This module consolidates:
 * - Status type and constants
 * - Terminal/failure/satisfaction predicates
 * - Valid state transitions
 * - UI rendering metadata (buckets, colors, icons, actionability)
 *
 * Created by D1a as the foundation for D1b/c/d migration.
 */

/**
 * Task status union — all 9 possible states.
 */
export type TaskStatus =
  | 'backlog'
  | 'queued'
  | 'blocked'
  | 'active'
  | 'review'
  | 'done'
  | 'cancelled'
  | 'failed'
  | 'error'

/**
 * All task statuses in a principled order (lifecycle progression).
 */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'queued',
  'blocked',
  'active',
  'review',
  'done',
  'cancelled',
  'failed',
  'error'
] as const

/**
 * Terminal statuses — task has reached end of lifecycle.
 * No further automatic transitions occur.
 */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'done',
  'cancelled',
  'failed',
  'error'
])

/**
 * Failure statuses — task did not complete successfully.
 * Subset of terminal statuses.
 */
export const FAILURE_STATUSES: ReadonlySet<TaskStatus> = new Set(['failed', 'error', 'cancelled'])

/**
 * Statuses that satisfy hard dependencies.
 * Only 'done' unblocks downstream tasks with hard dependencies.
 */
export const HARD_SATISFIED_STATUSES: ReadonlySet<TaskStatus> = new Set(['done'])

/**
 * Valid state transitions — adjacency list representation.
 * Copied verbatim from src/shared/task-transitions.ts (as of D1a).
 */
export const VALID_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  backlog: ['queued', 'blocked', 'cancelled'],
  queued: ['active', 'blocked', 'cancelled'],
  blocked: ['queued', 'cancelled'],
  active: ['review', 'done', 'failed', 'error', 'cancelled', 'queued'],
  review: ['queued', 'done', 'cancelled'],
  done: ['cancelled'],
  failed: ['queued', 'cancelled'],
  error: ['queued', 'cancelled'],
  cancelled: []
}

/**
 * Bucket keys — the 7 UI partitions used by the sprint pipeline.
 * Derived from src/renderer/src/lib/partitionSprintTasks.ts.
 */
export type BucketKey =
  | 'backlog'
  | 'todo'
  | 'blocked'
  | 'inProgress'
  | 'awaitingReview'
  | 'done'
  | 'failed'

/**
 * Per-status UI metadata for rendering in the sprint pipeline.
 */
export interface StatusMetadata {
  /** Display label for the status */
  label: string
  /** Which UI bucket this status maps to */
  bucketKey: BucketKey
  /** CSS variable name for status color (e.g., "--bde-status-active") */
  colorToken: string
  /** lucide-react icon name for this status */
  iconName: string
  /** Can the user manually transition from this status via UI actions? */
  actionable: boolean
}

/**
 * Status metadata record — maps every TaskStatus to its UI rendering config.
 *
 * Sources:
 * - bucketKey: derived from partitionSprintTasks.ts
 * - colorToken: derived from task-format.ts getDotColor()
 * - iconName: inferred from UI patterns
 * - actionable: derived from TaskDetailActionButtons.tsx
 */
export const STATUS_METADATA: Readonly<Record<TaskStatus, StatusMetadata>> = {
  backlog: {
    label: 'Backlog',
    bucketKey: 'backlog',
    colorToken: '--bde-accent',
    iconName: 'Inbox',
    actionable: true
  },
  queued: {
    label: 'Queued',
    bucketKey: 'todo',
    colorToken: '--bde-accent',
    iconName: 'Clock',
    actionable: true
  },
  blocked: {
    label: 'Blocked',
    bucketKey: 'blocked',
    colorToken: '--bde-warning',
    iconName: 'AlertCircle',
    actionable: true
  },
  active: {
    label: 'In Progress',
    bucketKey: 'inProgress',
    colorToken: '--bde-status-active',
    iconName: 'Play',
    actionable: false
  },
  review: {
    label: 'Awaiting Review',
    bucketKey: 'awaitingReview',
    colorToken: '--bde-status-review',
    iconName: 'Eye',
    actionable: true
  },
  done: {
    label: 'Done',
    bucketKey: 'done',
    colorToken: '--bde-status-done',
    iconName: 'CheckCircle',
    actionable: false
  },
  cancelled: {
    label: 'Cancelled',
    bucketKey: 'failed',
    colorToken: '--bde-danger',
    iconName: 'Slash',
    actionable: false
  },
  failed: {
    label: 'Failed',
    bucketKey: 'failed',
    colorToken: '--bde-danger',
    iconName: 'XCircle',
    actionable: true
  },
  error: {
    label: 'Error',
    bucketKey: 'failed',
    colorToken: '--bde-danger',
    iconName: 'AlertTriangle',
    actionable: true
  }
}

/**
 * Check if a transition from one status to another is valid.
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
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
