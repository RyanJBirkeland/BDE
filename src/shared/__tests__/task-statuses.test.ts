import { describe, it, expect } from 'vitest'
import { ALL_TASK_STATUSES, TASK_STATUS } from '../task-statuses'
import { isTerminal, isFailure, TERMINAL_STATUSES, TASK_STATUSES } from '../task-state-machine'

describe('task-statuses', () => {
  describe('ALL_TASK_STATUSES', () => {
    it('contains all 9 expected statuses', () => {
      expect(ALL_TASK_STATUSES).toHaveLength(9)
    })

    it('is the same reference as TASK_STATUSES from task-state-machine', () => {
      expect(ALL_TASK_STATUSES).toBe(TASK_STATUSES)
    })
  })

  describe('TASK_STATUS', () => {
    it('has exactly 9 keys — one per status', () => {
      expect(Object.keys(TASK_STATUS)).toHaveLength(9)
    })

    it('values match ALL_TASK_STATUSES entries', () => {
      const values = new Set(Object.values(TASK_STATUS))
      for (const status of ALL_TASK_STATUSES) {
        expect(values.has(status)).toBe(true)
      }
    })

    it('provides typed access to every status', () => {
      expect(TASK_STATUS.BACKLOG).toBe('backlog')
      expect(TASK_STATUS.QUEUED).toBe('queued')
      expect(TASK_STATUS.BLOCKED).toBe('blocked')
      expect(TASK_STATUS.ACTIVE).toBe('active')
      expect(TASK_STATUS.REVIEW).toBe('review')
      expect(TASK_STATUS.DONE).toBe('done')
      expect(TASK_STATUS.CANCELLED).toBe('cancelled')
      expect(TASK_STATUS.FAILED).toBe('failed')
      expect(TASK_STATUS.ERROR).toBe('error')
    })
  })

  describe('re-exported predicates', () => {
    it('isTerminal returns true for done/cancelled/failed/error', () => {
      expect(isTerminal('done')).toBe(true)
      expect(isTerminal('cancelled')).toBe(true)
      expect(isTerminal('failed')).toBe(true)
      expect(isTerminal('error')).toBe(true)
    })

    it('isTerminal returns false for non-terminal statuses', () => {
      expect(isTerminal('queued')).toBe(false)
      expect(isTerminal('active')).toBe(false)
      expect(isTerminal('blocked')).toBe(false)
    })

    it('isFailure returns true for failed/error/cancelled', () => {
      expect(isFailure('failed')).toBe(true)
      expect(isFailure('error')).toBe(true)
      expect(isFailure('cancelled')).toBe(true)
    })

    it('isFailure returns false for done', () => {
      expect(isFailure('done')).toBe(false)
    })

    it('TERMINAL_STATUSES has 4 entries', () => {
      expect(TERMINAL_STATUSES.size).toBe(4)
    })
  })
})
