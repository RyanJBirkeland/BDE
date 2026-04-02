import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before module import
const mockBroadcast = vi.fn()
vi.mock('../../queue-api/router', () => ({
  sseBroadcaster: {
    broadcast: (...args: unknown[]) => mockBroadcast(...args)
  }
}))

const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      { webContents: { send: (...args: unknown[]) => mockSend(...args) } },
      { webContents: { send: (...args: unknown[]) => mockSend(...args) } }
    ])
  }
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

import { BrowserWindow } from 'electron'
import { onSprintMutation, notifySprintMutation } from '../sprint-listeners'
import type { SprintTask } from '../../../shared/types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    status: 'active',
    priority: 'medium',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
      expect(mockLogError).toHaveBeenCalledOnce()

      unsub1()
      unsub2()
    })
  })

  describe('SSE broadcast', () => {
    it('broadcasts task:updated event with id and status', () => {
      const task = makeTask({ id: 'task-sse', status: 'done' })
      notifySprintMutation('updated', task)

      expect(mockBroadcast).toHaveBeenCalledWith('task:updated', {
        id: 'task-sse',
        status: 'done'
      })
    })

    it('broadcasts additional task:queued event when task status is queued', () => {
      const task = makeTask({ id: 'task-q', status: 'queued', title: 'Queued Task', priority: 'high' })
      notifySprintMutation('updated', task)

      expect(mockBroadcast).toHaveBeenCalledWith('task:updated', {
        id: 'task-q',
        status: 'queued'
      })
      expect(mockBroadcast).toHaveBeenCalledWith('task:queued', {
        id: 'task-q',
        title: 'Queued Task',
        priority: 'high'
      })
      expect(mockBroadcast).toHaveBeenCalledTimes(2)
    })

    it('does not broadcast task:queued for non-queued statuses', () => {
      const task = makeTask({ status: 'active' })
      notifySprintMutation('updated', task)

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith('task:updated', expect.any(Object))
    })
  })

  describe('IPC broadcast', () => {
    it('sends sprint:externalChange to all renderer windows', () => {
      const task = makeTask()
      notifySprintMutation('created', task)

      const windows = BrowserWindow.getAllWindows()
      expect(windows).toHaveLength(2)
      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(mockSend).toHaveBeenCalledWith('sprint:externalChange')
    })

    it('handles zero open windows gracefully', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([])

      expect(() => notifySprintMutation('updated', makeTask())).not.toThrow()
      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
