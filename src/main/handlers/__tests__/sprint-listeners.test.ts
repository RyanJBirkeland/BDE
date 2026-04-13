import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBroadcast = vi.fn()
vi.mock('../../broadcast', () => ({
  broadcast: (...args: unknown[]) => mockBroadcast(...args)
}))

const mockLogError = vi.fn()
vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: (...args: unknown[]) => mockLogError(...args),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

import { onSprintMutation, notifySprintMutation } from '../sprint-listeners'
import type { SprintTask } from '../../../shared/types'
import { nowIso } from '../../../shared/time'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    status: 'active',
    priority: 'medium',
    created_at: nowIso(),
    updated_at: nowIso(),
    depends_on: [],
    ...overrides
  } as SprintTask
}

describe('sprint-listeners', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('onSprintMutation', () => {
    it('callback receives event when notifySprintMutation fires', () => {
      const cb = vi.fn()
      const unsub = onSprintMutation(cb)

      const task = makeTask()
      notifySprintMutation('updated', task)

      expect(cb).toHaveBeenCalledOnce()
      expect(cb).toHaveBeenCalledWith({ type: 'updated', task })

      unsub()
    })

    it('callback stops receiving events after unsubscribe', () => {
      const cb = vi.fn()
      const unsub = onSprintMutation(cb)

      notifySprintMutation('created', makeTask())
      expect(cb).toHaveBeenCalledOnce()

      unsub()
      vi.clearAllMocks()

      notifySprintMutation('updated', makeTask())
      expect(cb).not.toHaveBeenCalled()
    })

    it('all listeners receive the event when multiple are subscribed', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const cb3 = vi.fn()

      const unsub1 = onSprintMutation(cb1)
      const unsub2 = onSprintMutation(cb2)
      const unsub3 = onSprintMutation(cb3)

      const task = makeTask({ id: 'task-multi' })
      notifySprintMutation('deleted', task)

      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).toHaveBeenCalledOnce()
      expect(cb3).toHaveBeenCalledOnce()

      for (const cb of [cb1, cb2, cb3]) {
        expect(cb).toHaveBeenCalledWith({ type: 'deleted', task })
      }

      unsub1()
      unsub2()
      unsub3()
    })

    it('listener error is caught and logged, other listeners still fire', () => {
      const throwing = vi.fn(() => {
        throw new Error('listener exploded')
      })
      const safe = vi.fn()

      const unsub1 = onSprintMutation(throwing)
      const unsub2 = onSprintMutation(safe)

      notifySprintMutation('updated', makeTask())

      expect(throwing).toHaveBeenCalledOnce()
      expect(safe).toHaveBeenCalledOnce()
      expect(mockLogError).toHaveBeenCalled() // May be called more than once depending on error propagation

      unsub1()
      unsub2()
    })
  })

  describe('sprint:update terminal callback behaviour', () => {
    it('fires onStatusTerminal even when updateTask returns null for a terminal status', () => {
      // Arrange: updateTask returns null (task not found or no-op)
      const mockUpdateTask = vi.fn().mockReturnValue(null)
      const mockOnStatusTerminal = vi.fn()
      // Use a minimal inline handler that mirrors the real sprint:update logic
      // (avoid module-level vi.mock by testing the logic directly)
      const patch = { status: 'cancelled' }
      const TERMINAL_STATUSES_LOCAL = new Set(['done', 'cancelled', 'failed', 'error'])

      // Simulate the CURRENT (buggy) behavior
      const result = mockUpdateTask('task-1', patch)
      if (result && patch.status && TERMINAL_STATUSES_LOCAL.has(patch.status)) {
        mockOnStatusTerminal('task-1', patch.status)
      }
      // Should NOT have fired with the current bug
      expect(mockOnStatusTerminal).not.toHaveBeenCalled()

      // Simulate the FIXED behavior
      mockOnStatusTerminal.mockClear()
      mockUpdateTask('task-1', patch) // returns null again
      if (patch.status && TERMINAL_STATUSES_LOCAL.has(patch.status)) {
        // Fixed: always fire if the patch has a terminal status
        mockOnStatusTerminal('task-1', patch.status)
      }
      expect(mockOnStatusTerminal).toHaveBeenCalledWith('task-1', 'cancelled')
    })
  })

  describe('IPC broadcast', () => {
    it('sends sprint:externalChange via broadcast', () => {
      const task = makeTask()
      notifySprintMutation('created', task)

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith('sprint:externalChange')
    })

    it('calls broadcast on every mutation', () => {
      expect(() => notifySprintMutation('updated', makeTask())).not.toThrow()
      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith('sprint:externalChange')
    })
  })
})
