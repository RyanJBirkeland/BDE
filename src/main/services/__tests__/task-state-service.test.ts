/**
 * Tests for task state transition validation service.
 */
import { describe, it, expect } from 'vitest'
import { validateTransition } from '../task-state-service'

describe('validateTransition', () => {
  describe('valid transitions', () => {
    it('should allow backlog → queued', () => {
      const result = validateTransition('backlog', 'queued')
      expect(result).toEqual({ ok: true })
    })

    it('should allow active → review', () => {
      const result = validateTransition('active', 'review')
      expect(result).toEqual({ ok: true })
    })

    it('should allow review → done', () => {
      const result = validateTransition('review', 'done')
      expect(result).toEqual({ ok: true })
    })

    it('should allow failed → queued (retry)', () => {
      const result = validateTransition('failed', 'queued')
      expect(result).toEqual({ ok: true })
    })

    it('should allow active → queued (reset)', () => {
      const result = validateTransition('active', 'queued')
      expect(result).toEqual({ ok: true })
    })
  })

  describe('invalid transitions', () => {
    it('should reject backlog → done', () => {
      const result = validateTransition('backlog', 'done')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('Invalid transition')
        expect(result.reason).toContain('backlog → done')
        expect(result.reason).toContain('Allowed:')
      }
    })

    it('should reject queued → done', () => {
      const result = validateTransition('queued', 'done')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('queued → done')
      }
    })

    it('should reject cancelled → any status (terminal)', () => {
      const result = validateTransition('cancelled', 'queued')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('cancelled → queued')
        expect(result.reason).toContain('Allowed: none')
      }
    })

    it('should reject done → active (terminal except cancel)', () => {
      const result = validateTransition('done', 'active')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('done → active')
      }
    })

    it('should reject review → failed (not in state machine)', () => {
      const result = validateTransition('review', 'failed')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('review → failed')
      }
    })
  })

  describe('error messages', () => {
    it('should include allowed transitions in error message', () => {
      const result = validateTransition('active', 'backlog')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        // active allows: review, done, failed, error, cancelled, queued
        expect(result.reason).toMatch(/Allowed:.*review/)
        expect(result.reason).toMatch(/done/)
        expect(result.reason).toMatch(/queued/)
      }
    })

    it('should show "none" for terminal cancelled status', () => {
      const result = validateTransition('cancelled', 'done')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('Allowed: none')
      }
    })
  })
})
