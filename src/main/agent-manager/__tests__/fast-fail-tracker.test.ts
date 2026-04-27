/**
 * FastFailTracker tests (EP-5 T-57).
 *
 * Verifies the true 30-second sliding window: failures older than the window
 * are evicted before the exhaustion check, and three failures within the
 * window trigger exhaustion.
 */
import { describe, it, expect } from 'vitest'
import { FastFailTracker } from '../error-registry'
import { FAST_FAIL_THRESHOLD_MS, MAX_FAST_FAILS } from '../types'

describe('FastFailTracker', () => {
  describe('sliding window eviction', () => {
    it('does not count a failure older than the window', () => {
      const tracker = new FastFailTracker()
      const staleTs = Date.now() - FAST_FAIL_THRESHOLD_MS - 1
      // Inject a stale failure by recording at a past timestamp
      tracker.record('task-1', 'old error', staleTs)
      tracker.record('task-1', 'recent error 1')
      tracker.record('task-1', 'recent error 2')

      // Only 2 recent entries remain — not exhausted
      expect(tracker.recentCount('task-1')).toBe(2)
      expect(tracker.isExhausted('task-1')).toBe(false)
    })

    it('evicts stale entries in-place so subsequent checks reflect the cleaned window', () => {
      const tracker = new FastFailTracker()
      const staleTs = Date.now() - FAST_FAIL_THRESHOLD_MS - 1
      tracker.record('task-1', 'stale', staleTs)

      // First call evicts the stale entry
      expect(tracker.recentCount('task-1')).toBe(0)
      // Second call still returns 0 — entry is gone, not re-added
      expect(tracker.recentCount('task-1')).toBe(0)
    })
  })

  describe('exhaustion threshold', () => {
    it('exhausts when three failures occur within the window', () => {
      const tracker = new FastFailTracker()
      const now = Date.now()
      for (let i = 0; i < MAX_FAST_FAILS; i++) {
        tracker.record('task-1', `error ${i}`, now + i)
      }
      expect(tracker.isExhausted('task-1')).toBe(true)
    })

    it('does not exhaust with two failures in the window', () => {
      const tracker = new FastFailTracker()
      tracker.record('task-1', 'error 1')
      tracker.record('task-1', 'error 2')
      expect(tracker.isExhausted('task-1')).toBe(false)
    })

    it('resets exhaustion when old failures fall outside the window', () => {
      const tracker = new FastFailTracker()
      // Simulate MAX_FAST_FAILS failures all just beyond the window
      const staleBase = Date.now() - FAST_FAIL_THRESHOLD_MS - 100
      for (let i = 0; i < MAX_FAST_FAILS; i++) {
        tracker.record('task-1', `stale error ${i}`, staleBase + i)
      }
      // All stale — should not be exhausted
      expect(tracker.isExhausted('task-1')).toBe(false)
    })
  })

  describe('task isolation', () => {
    it('tracks failures independently per task', () => {
      const tracker = new FastFailTracker()
      const now = Date.now()
      for (let i = 0; i < MAX_FAST_FAILS; i++) {
        tracker.record('task-a', 'error', now + i)
      }
      tracker.record('task-b', 'error', now)

      expect(tracker.isExhausted('task-a')).toBe(true)
      expect(tracker.isExhausted('task-b')).toBe(false)
    })
  })

  describe('clear', () => {
    it('removes all history for the task', () => {
      const tracker = new FastFailTracker()
      const now = Date.now()
      for (let i = 0; i < MAX_FAST_FAILS; i++) {
        tracker.record('task-1', 'error', now + i)
      }
      expect(tracker.isExhausted('task-1')).toBe(true)
      tracker.clear('task-1')
      expect(tracker.recentCount('task-1')).toBe(0)
      expect(tracker.isExhausted('task-1')).toBe(false)
    })
  })
})
