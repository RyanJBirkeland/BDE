/**
 * Task status constants — single source of truth for all task lifecycle states.
 *
 * This module consolidates the canonical status type, constant sets, UI metadata,
 * and predicate helpers. All other modules should import from here.
 *
 * State machine logic (transition table, validateTransition) lives in task-state-machine.ts.
 * UI rendering metadata (STATUS_METADATA, BucketKey) lives here so shared tests
 * can reference it without importing from the renderer layer.
 */

// ---------------------------------------------------------------------------
// Re-export everything from task-state-machine so callers have one import path
// ---------------------------------------------------------------------------
export type { TaskStatus, ValidationResult } from './task-state-machine'
export {
  TASK_STATUSES,
  TERMINAL_STATUSES,
  FAILURE_STATUSES,
  HARD_SATISFIED_STATUSES,
  VALID_TRANSITIONS,
  isValidTransition,
  isTerminal,
  isFailure,
  isHardSatisfied,
  validateTransition
} from './task-state-machine'

import type { TaskStatus } from './task-state-machine'
import { TASK_STATUSES } from './task-state-machine'

/**
 * All task statuses as a readonly const-tuple — useful for exhaustiveness checks
 * and runtime enumeration.
 */
export const ALL_TASK_STATUSES = TASK_STATUSES

/**
 * Object-style status constants for use in comparisons and assignments.
 * Derived from TASK_STATUSES so no string duplication occurs.
 *
 * Prefer `TASK_STATUS.ACTIVE` over the raw string literal `'active'`
 * to catch typos at compile time.
 */
export const TASK_STATUS = {
  BACKLOG: 'backlog',
  QUEUED: 'queued',
  BLOCKED: 'blocked',
  ACTIVE: 'active',
  REVIEW: 'review',
  DONE: 'done',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  ERROR: 'error'
} as const satisfies Record<Uppercase<TaskStatus>, TaskStatus>

// ---------------------------------------------------------------------------
// UI metadata — kept in shared so tests and shared modules can reference it
// without importing from the renderer layer (which would invert the dependency).
// ---------------------------------------------------------------------------

/**
 * Bucket keys — the 7 UI partitions used by the sprint pipeline.
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
  /** CSS variable name for status color (e.g., "--fleet-status-active") */
  colorToken: string
  /** lucide-react icon name for this status */
  iconName: string
  /** Can the user manually transition from this status via UI actions? */
  actionable: boolean
}

/**
 * Status metadata record — maps every TaskStatus to its UI rendering config.
 */
export const STATUS_METADATA: Readonly<Record<TaskStatus, StatusMetadata>> = {
  backlog: {
    label: 'Backlog',
    bucketKey: 'backlog',
    colorToken: '--fleet-accent',
    iconName: 'Inbox',
    actionable: true
  },
  queued: {
    label: 'Queued',
    bucketKey: 'todo',
    colorToken: '--fleet-accent',
    iconName: 'Clock',
    actionable: true
  },
  blocked: {
    label: 'Blocked',
    bucketKey: 'blocked',
    colorToken: '--fleet-warning',
    iconName: 'AlertCircle',
    actionable: true
  },
  active: {
    label: 'In Progress',
    bucketKey: 'inProgress',
    colorToken: '--fleet-status-active',
    iconName: 'Play',
    actionable: false
  },
  review: {
    label: 'Awaiting Review',
    bucketKey: 'awaitingReview',
    colorToken: '--fleet-status-review',
    iconName: 'Eye',
    actionable: true
  },
  done: {
    label: 'Done',
    bucketKey: 'done',
    colorToken: '--fleet-status-done',
    iconName: 'CheckCircle',
    actionable: false
  },
  cancelled: {
    label: 'Cancelled',
    bucketKey: 'failed',
    colorToken: '--fleet-danger',
    iconName: 'Slash',
    actionable: false
  },
  failed: {
    label: 'Failed',
    bucketKey: 'failed',
    colorToken: '--fleet-danger',
    iconName: 'XCircle',
    actionable: true
  },
  error: {
    label: 'Error',
    bucketKey: 'failed',
    colorToken: '--fleet-danger',
    iconName: 'AlertTriangle',
    actionable: true
  }
}
