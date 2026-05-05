import { describe, it, expect } from 'vitest'
import {
  type TaskStatus,
  TASK_STATUSES,
  TERMINAL_STATUSES,
  FAILURE_STATUSES,
  HARD_SATISFIED_STATUSES,
  DEPENDENCY_TRIGGER_STATUSES,
  VALID_TRANSITIONS,
  isValidTransition,
  isTerminal,
  isFailure,
  isHardSatisfied,
  isTaskStatus
} from '../task-state-machine'
import { type BucketKey, STATUS_METADATA } from '../task-statuses'

describe('task-state-machine', () => {
  describe('TASK_STATUSES', () => {
    it('should contain exactly 10 statuses', () => {
      expect(TASK_STATUSES).toHaveLength(10)
    })

    it('should include all expected statuses', () => {
      const expected: TaskStatus[] = [
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
      ]
      expect(TASK_STATUSES).toEqual(expected)
    })
  })

  describe('TERMINAL_STATUSES', () => {
    it('should contain exactly 4 terminal statuses', () => {
      expect(TERMINAL_STATUSES.size).toBe(4)
    })

    it('should include done, cancelled, failed, error', () => {
      expect(TERMINAL_STATUSES.has('done')).toBe(true)
      expect(TERMINAL_STATUSES.has('cancelled')).toBe(true)
      expect(TERMINAL_STATUSES.has('failed')).toBe(true)
      expect(TERMINAL_STATUSES.has('error')).toBe(true)
    })

    it('should not include non-terminal statuses', () => {
      expect(TERMINAL_STATUSES.has('backlog')).toBe(false)
      expect(TERMINAL_STATUSES.has('queued')).toBe(false)
      expect(TERMINAL_STATUSES.has('blocked')).toBe(false)
      expect(TERMINAL_STATUSES.has('active')).toBe(false)
      expect(TERMINAL_STATUSES.has('review')).toBe(false)
    })
  })

  describe('FAILURE_STATUSES', () => {
    it('should contain exactly 3 failure statuses', () => {
      expect(FAILURE_STATUSES.size).toBe(3)
    })

    it('should include failed, error, cancelled', () => {
      expect(FAILURE_STATUSES.has('failed')).toBe(true)
      expect(FAILURE_STATUSES.has('error')).toBe(true)
      expect(FAILURE_STATUSES.has('cancelled')).toBe(true)
    })

    it('should not include success or in-progress statuses', () => {
      expect(FAILURE_STATUSES.has('done')).toBe(false)
      expect(FAILURE_STATUSES.has('active')).toBe(false)
    })
  })

  describe('HARD_SATISFIED_STATUSES', () => {
    it('should contain exactly 2 statuses', () => {
      expect(HARD_SATISFIED_STATUSES.size).toBe(2)
    })

    it('should include done and approved', () => {
      expect(HARD_SATISFIED_STATUSES.has('done')).toBe(true)
      expect(HARD_SATISFIED_STATUSES.has('approved')).toBe(true)
    })

    it('should not include failure or in-progress statuses', () => {
      expect(HARD_SATISFIED_STATUSES.has('failed')).toBe(false)
      expect(HARD_SATISFIED_STATUSES.has('cancelled')).toBe(false)
      expect(HARD_SATISFIED_STATUSES.has('active')).toBe(false)
    })
  })

  describe('VALID_TRANSITIONS', () => {
    it('should have an entry for every status', () => {
      for (const status of TASK_STATUSES) {
        expect(VALID_TRANSITIONS[status]).toBeDefined()
      }
    })

    it('should have exactly one entry per TASK_STATUSES value (exhaustive + no extras)', () => {
      const transitionKeys = Object.keys(VALID_TRANSITIONS).sort()
      const statusList = [...TASK_STATUSES].sort()
      expect(transitionKeys).toEqual(statusList)
    })

    it('should allow backlog → queued', () => {
      expect(VALID_TRANSITIONS.backlog).toContain('queued')
    })

    it('should allow queued → active', () => {
      expect(VALID_TRANSITIONS.queued).toContain('active')
    })

    it('should allow active → review', () => {
      expect(VALID_TRANSITIONS.active).toContain('review')
    })

    it('should allow review → done', () => {
      expect(VALID_TRANSITIONS.review).toContain('done')
    })

    it('should not allow done → active (invalid reverse transition)', () => {
      expect(VALID_TRANSITIONS.done).not.toContain('active')
    })

    it('should allow cancelled → queued and cancelled → backlog (revival paths)', () => {
      // Cancelled tasks can be revived in place; MCP TERMINAL_STATE_RESET_PATCH
      // clears stale runtime fields on any terminal→queued/backlog transition (issue #708).
      expect(VALID_TRANSITIONS.cancelled).toContain('queued')
      expect(VALID_TRANSITIONS.cancelled).toContain('backlog')
    })

    it('should allow cancelled → done (manual recovery escape hatch)', () => {
      expect(VALID_TRANSITIONS.cancelled).toContain('done')
    })

    it('should allow failed → done and error → done (manual recovery escape hatches)', () => {
      expect(VALID_TRANSITIONS.failed).toContain('done')
      expect(VALID_TRANSITIONS.error).toContain('done')
    })
  })

  describe('isValidTransition', () => {
    it('should return true for valid transitions', () => {
      expect(isValidTransition('backlog', 'queued')).toBe(true)
      expect(isValidTransition('queued', 'active')).toBe(true)
      expect(isValidTransition('active', 'review')).toBe(true)
      expect(isValidTransition('review', 'done')).toBe(true)
      expect(isValidTransition('blocked', 'queued')).toBe(true)
      expect(isValidTransition('failed', 'queued')).toBe(true)
    })

    it('should return true for queued → done (auto-complete edge)', () => {
      // queued → done is permitted for the auto-complete path: agent-manager
      // detects that matching work already landed on origin/main out-of-band.
      expect(isValidTransition('queued', 'done')).toBe(true)
    })

    it('should return true for queued → failed (terminal retry while orphan-raced)', () => {
      // When the orphan-recovery loop races the claim→spawn window, it resets the task
      // to 'queued' before the spawned agent finishes. If retries are exhausted, the
      // failure handler needs queued→failed to land.
      expect(isValidTransition('queued', 'failed')).toBe(true)
    })

    it('should return true for queued → error (orphan recovery at cap)', () => {
      // When orphan_recovery_count reaches MAX_ORPHAN_RECOVERY_COUNT and the task is
      // still in 'queued' state, orphan recovery must be able to mark it error.
      expect(isValidTransition('queued', 'error')).toBe(true)
    })

    it('should return true for revival transitions (terminal → queued/backlog)', () => {
      // Pre-flight "move back to holding": queued→backlog (issue #708)
      expect(isValidTransition('queued', 'backlog')).toBe(true)
      // Cancelled task revival: cancelled→queued and cancelled→backlog (issue #708)
      expect(isValidTransition('cancelled', 'queued')).toBe(true)
      expect(isValidTransition('cancelled', 'backlog')).toBe(true)
    })

    it('should return false for invalid transitions', () => {
      expect(isValidTransition('done', 'active')).toBe(false)
      expect(isValidTransition('backlog', 'done')).toBe(false)
    })
  })

  describe('isTerminal', () => {
    it('should return true for terminal statuses', () => {
      expect(isTerminal('done')).toBe(true)
      expect(isTerminal('cancelled')).toBe(true)
      expect(isTerminal('failed')).toBe(true)
      expect(isTerminal('error')).toBe(true)
    })

    it('should return false for non-terminal statuses', () => {
      expect(isTerminal('backlog')).toBe(false)
      expect(isTerminal('queued')).toBe(false)
      expect(isTerminal('blocked')).toBe(false)
      expect(isTerminal('active')).toBe(false)
      expect(isTerminal('review')).toBe(false)
      expect(isTerminal('approved')).toBe(false)
    })
  })

  describe('isFailure', () => {
    it('should return true for failure statuses', () => {
      expect(isFailure('failed')).toBe(true)
      expect(isFailure('error')).toBe(true)
      expect(isFailure('cancelled')).toBe(true)
    })

    it('should return false for non-failure statuses', () => {
      expect(isFailure('done')).toBe(false)
      expect(isFailure('active')).toBe(false)
      expect(isFailure('queued')).toBe(false)
    })
  })

  describe('isHardSatisfied', () => {
    it('should return true for done and approved', () => {
      expect(isHardSatisfied('done')).toBe(true)
      expect(isHardSatisfied('approved')).toBe(true)
    })

    it('should return false for all other statuses', () => {
      expect(isHardSatisfied('failed')).toBe(false)
      expect(isHardSatisfied('cancelled')).toBe(false)
      expect(isHardSatisfied('active')).toBe(false)
      expect(isHardSatisfied('queued')).toBe(false)
      expect(isHardSatisfied('error')).toBe(false)
      expect(isHardSatisfied('review')).toBe(false)
    })
  })

  describe('STATUS_METADATA', () => {
    it('should have an entry for every TaskStatus', () => {
      for (const status of TASK_STATUSES) {
        expect(STATUS_METADATA[status]).toBeDefined()
        expect(STATUS_METADATA[status].label).toBeTruthy()
        expect(STATUS_METADATA[status].bucketKey).toBeTruthy()
        expect(STATUS_METADATA[status].colorToken).toBeTruthy()
        expect(STATUS_METADATA[status].iconName).toBeTruthy()
        expect(typeof STATUS_METADATA[status].actionable).toBe('boolean')
      }
    })

    it('should have valid bucketKey values', () => {
      const validBuckets: BucketKey[] = [
        'backlog',
        'todo',
        'blocked',
        'inProgress',
        'awaitingReview',
        'approved',
        'done',
        'failed'
      ]

      for (const status of TASK_STATUSES) {
        const bucket = STATUS_METADATA[status].bucketKey
        expect(validBuckets).toContain(bucket)
      }
    })

    it('should have exactly 8 distinct bucket keys', () => {
      const buckets = new Set(TASK_STATUSES.map((s) => STATUS_METADATA[s].bucketKey))
      expect(buckets.size).toBe(8)
    })

    it('should map backlog status to backlog bucket', () => {
      expect(STATUS_METADATA.backlog.bucketKey).toBe('backlog')
    })

    it('should map queued status to todo bucket', () => {
      expect(STATUS_METADATA.queued.bucketKey).toBe('todo')
    })

    it('should map blocked status to blocked bucket', () => {
      expect(STATUS_METADATA.blocked.bucketKey).toBe('blocked')
    })

    it('should map active status to inProgress bucket', () => {
      expect(STATUS_METADATA.active.bucketKey).toBe('inProgress')
    })

    it('should map review status to awaitingReview bucket', () => {
      expect(STATUS_METADATA.review.bucketKey).toBe('awaitingReview')
    })

    it('should map done status to done bucket', () => {
      expect(STATUS_METADATA.done.bucketKey).toBe('done')
    })

    it('should map failure statuses to failed bucket', () => {
      expect(STATUS_METADATA.cancelled.bucketKey).toBe('failed')
      expect(STATUS_METADATA.failed.bucketKey).toBe('failed')
      expect(STATUS_METADATA.error.bucketKey).toBe('failed')
    })

    it('should mark non-terminal statuses as actionable (except active)', () => {
      expect(STATUS_METADATA.backlog.actionable).toBe(true)
      expect(STATUS_METADATA.queued.actionable).toBe(true)
      expect(STATUS_METADATA.blocked.actionable).toBe(true)
      expect(STATUS_METADATA.review.actionable).toBe(true)
      expect(STATUS_METADATA.active.actionable).toBe(false) // agent running
    })

    it('should mark terminal statuses as non-actionable (except retriable failures)', () => {
      expect(STATUS_METADATA.done.actionable).toBe(false)
      expect(STATUS_METADATA.cancelled.actionable).toBe(false)
      expect(STATUS_METADATA.failed.actionable).toBe(true) // can retry
      expect(STATUS_METADATA.error.actionable).toBe(true) // can retry
    })

    it('should use CSS variable format for color tokens', () => {
      for (const status of TASK_STATUSES) {
        const token = STATUS_METADATA[status].colorToken
        expect(token.startsWith('--fleet-')).toBe(true)
      }
    })
  })

  describe('approved status', () => {
    it('includes approved in TASK_STATUSES', () => {
      expect(TASK_STATUSES).toContain('approved')
    })

    it('allows review → approved transition', () => {
      expect(isValidTransition('review', 'approved')).toBe(true)
    })

    it('allows approved → done transition', () => {
      expect(isValidTransition('approved', 'done')).toBe(true)
    })

    it('allows approved → queued transition', () => {
      expect(isValidTransition('approved', 'queued')).toBe(true)
    })

    it('allows approved → cancelled transition', () => {
      expect(isValidTransition('approved', 'cancelled')).toBe(true)
    })

    it('satisfies hard dependencies', () => {
      expect(isHardSatisfied('approved')).toBe(true)
    })

    it('is in DEPENDENCY_TRIGGER_STATUSES', () => {
      expect(DEPENDENCY_TRIGGER_STATUSES.has('approved')).toBe(true)
    })

    it('is not a terminal status', () => {
      expect(isTerminal('approved')).toBe(false)
    })
  })

  describe('DEPENDENCY_TRIGGER_STATUSES', () => {
    it('includes all terminal statuses', () => {
      for (const status of TERMINAL_STATUSES) {
        expect(DEPENDENCY_TRIGGER_STATUSES.has(status)).toBe(true)
      }
    })

    it('includes approved', () => {
      expect(DEPENDENCY_TRIGGER_STATUSES.has('approved')).toBe(true)
    })

    it('does not include non-terminal, non-approved statuses', () => {
      expect(DEPENDENCY_TRIGGER_STATUSES.has('active')).toBe(false)
      expect(DEPENDENCY_TRIGGER_STATUSES.has('review')).toBe(false)
      expect(DEPENDENCY_TRIGGER_STATUSES.has('queued')).toBe(false)
    })
  })

  describe('Predicate coverage for all statuses', () => {
    it('should classify every status through all 4 predicates', () => {
      // This test ensures every status is explicitly handled by the predicates
      for (const status of TASK_STATUSES) {
        // Every status should have a boolean result for each predicate
        expect(typeof isTerminal(status)).toBe('boolean')
        expect(typeof isFailure(status)).toBe('boolean')
        expect(typeof isHardSatisfied(status)).toBe('boolean')
        // Every status should appear in STATUS_METADATA
        expect(STATUS_METADATA[status]).toBeDefined()
      }
    })
  })

  describe('isTaskStatus', () => {
    it('returns true for valid statuses', () => {
      expect(isTaskStatus('queued')).toBe(true)
      expect(isTaskStatus('active')).toBe(true)
      expect(isTaskStatus('done')).toBe(true)
    })

    it('returns false for null', () => {
      expect(isTaskStatus(null as unknown as string)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isTaskStatus(undefined as unknown as string)).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isTaskStatus('')).toBe(false)
    })

    it('returns false for numeric 0', () => {
      expect(isTaskStatus(0 as unknown as string)).toBe(false)
    })

    it('returns false for plain object', () => {
      expect(isTaskStatus({} as unknown as string)).toBe(false)
    })

    it('returns false for wrong-case DONE', () => {
      expect(isTaskStatus('DONE')).toBe(false)
    })

    it('returns false for wrong-case Active', () => {
      expect(isTaskStatus('Active')).toBe(false)
    })

    it('returns false for unknown string pending', () => {
      expect(isTaskStatus('pending')).toBe(false)
    })
  })
})
