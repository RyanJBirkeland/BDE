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

import { registerDashboardHandlers } from '../dashboard-handlers'
import { getCompletionsPerHour, getRecentEvents } from '../../data/dashboard-queries'
import { safeHandle } from '../../ipc-utils'

describe('Dashboard handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAll.mockReturnValue([])
  })

  it('registers all 5 dashboard channels', () => {
    registerDashboardHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(5)
    expect(safeHandle).toHaveBeenCalledWith('dashboard:completionsPerHour', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('dashboard:recentEvents', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('dashboard:dailySuccessRate', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('system:loadAverage', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('clipboard:readImage', expect.any(Function))
  })

  describe('getCompletionsPerHour', () => {
    it('calls db.prepare with a GROUP BY query and returns rows', () => {
      const buckets = [
        { hour: '2026-03-24T10:00:00', successCount: 3, failedCount: 0 },
        { hour: '2026-03-24T11:00:00', successCount: 5, failedCount: 1 }
      ]
      mockAll.mockReturnValueOnce(buckets)

      const result = getCompletionsPerHour()

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('GROUP BY hour'))
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('agent_runs'))
      expect(result).toBe(buckets)
    })

    it('returns success/failed split per hour', () => {
      const buckets = [
        { hour: '2026-03-24T09:00:00', successCount: 2, failedCount: 0 },
        { hour: '2026-03-24T10:00:00', successCount: 3, failedCount: 1 }
      ]
      mockAll.mockReturnValueOnce(buckets)

      const result = getCompletionsPerHour()

      const currentHour = result.find((b) => b.successCount === 3 && b.failedCount === 1)
      const priorHour = result.find((b) => b.successCount === 2 && b.failedCount === 0)
      expect(currentHour).toBeDefined()
      expect(priorHour).toBeDefined()
    })

    it('returns empty array when no completions', () => {
      mockAll.mockReturnValueOnce([])
      const result = getCompletionsPerHour()
      expect(result).toEqual([])
    })

    it('SQL query uses successCount and failedCount columns', () => {
      mockAll.mockReturnValueOnce([])
      getCompletionsPerHour()
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('successCount'))
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('failedCount'))
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

    it('dashboard:completionsPerHour handler returns completions', async () => {
      const buckets = [{ hour: '2026-03-24T10:00:00', successCount: 2, failedCount: 0 }]
      mockAll.mockReturnValueOnce(buckets)
      const handlers = captureHandlers()

      const result = await handlers['dashboard:completionsPerHour'](mockEvent)

      expect(result).toBe(buckets)
    })

    it('dashboard:recentEvents handler passes limit to getRecentEvents', async () => {
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

      const result = await handlers['dashboard:recentEvents'](mockEvent, 10)

      expect(mockAll).toHaveBeenCalledWith(10)
      expect(result).toBe(events)
    })

    it('dashboard:recentEvents handler uses default limit when not provided', async () => {
      mockAll.mockReturnValueOnce([])
      const handlers = captureHandlers()

      await handlers['dashboard:recentEvents'](mockEvent, undefined)

      expect(mockAll).toHaveBeenCalledWith(20)
    })
  })
})
