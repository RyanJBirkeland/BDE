/**
 * Dashboard handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const mockAll = vi.fn()
const mockPrepare = vi.fn(() => ({ all: mockAll }))

vi.mock('../../db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare }))
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

import {
  registerDashboardHandlers,
  getCompletionsPerHour,
  getRecentEvents
} from '../dashboard-handlers'
import { safeHandle } from '../../ipc-utils'

describe('Dashboard handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAll.mockReturnValue([])
  })

  it('registers all 2 dashboard channels', () => {
    registerDashboardHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(2)
    expect(safeHandle).toHaveBeenCalledWith('agent:completionsPerHour', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('agent:recentEvents', expect.any(Function))
  })

  describe('getCompletionsPerHour', () => {
    it('calls db.prepare with a GROUP BY query and returns rows', () => {
      const buckets = [
        { hour: '2026-03-24T10:00:00', count: 3 },
        { hour: '2026-03-24T11:00:00', count: 5 }
      ]
      mockAll.mockReturnValueOnce(buckets)

      const result = getCompletionsPerHour()

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('GROUP BY hour'))
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('agent_runs'))
      expect(result).toBe(buckets)
    })

    it('returns empty array when no completions', () => {
      mockAll.mockReturnValueOnce([])
      const result = getCompletionsPerHour()
      expect(result).toEqual([])
    })
  })

  describe('getRecentEvents', () => {
    it('queries agent_events with JOINs and default limit of 20', () => {
      const events = [
        {
          id: 1,
          agent_id: 'a1',
          event_type: 'output',
          payload: '{}',
          timestamp: 1000,
          task_title: 'Fix auth'
        }
      ]
      mockAll.mockReturnValueOnce(events)

      const result = getRecentEvents()

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('agent_events'))
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN agent_runs'))
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN sprint_tasks'))
      expect(mockAll).toHaveBeenCalledWith(20)
      expect(result).toBe(events)
    })

    it('uses provided limit', () => {
      mockAll.mockReturnValueOnce([])

      getRecentEvents(50)

      expect(mockAll).toHaveBeenCalledWith(50)
    })

    it('returns events ordered by timestamp desc', () => {
      getRecentEvents(10)
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY ae.timestamp DESC')
      )
    })
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const handlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        handlers[channel] = handler
      })
      registerDashboardHandlers()
      return handlers
    }

    const mockEvent = {} as IpcMainInvokeEvent

    it('agent:completionsPerHour handler returns completions', async () => {
      const buckets = [{ hour: '2026-03-24T10:00:00', count: 2 }]
      mockAll.mockReturnValueOnce(buckets)
      const handlers = captureHandlers()

      const result = await handlers['agent:completionsPerHour'](mockEvent)

      expect(result).toBe(buckets)
    })

    it('agent:recentEvents handler passes limit to getRecentEvents', async () => {
      const events = [
        {
          id: 1,
          agent_id: 'a1',
          event_type: 'output',
          payload: '{}',
          timestamp: 1000,
          task_title: null
        }
      ]
      mockAll.mockReturnValueOnce(events)
      const handlers = captureHandlers()

      const result = await handlers['agent:recentEvents'](mockEvent, 10)

      expect(mockAll).toHaveBeenCalledWith(10)
      expect(result).toBe(events)
    })

    it('agent:recentEvents handler uses default limit when not provided', async () => {
      mockAll.mockReturnValueOnce([])
      const handlers = captureHandlers()

      await handlers['agent:recentEvents'](mockEvent, undefined)

      expect(mockAll).toHaveBeenCalledWith(20)
    })
  })
})
