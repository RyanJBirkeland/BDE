/**
 * Cost handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('../../cost-queries', () => ({
  getCostSummary: vi.fn(),
  getRecentAgentRunsWithCost: vi.fn(),
  getAgentHistory: vi.fn()
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

import { registerCostHandlers } from '../cost-handlers'
import { safeHandle } from '../../ipc-utils'
import { getCostSummary, getRecentAgentRunsWithCost, getAgentHistory } from '../../cost-queries'

describe('Cost handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 3 cost channels', () => {
    registerCostHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(3)
    expect(safeHandle).toHaveBeenCalledWith('cost:summary', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('cost:agentRuns', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('cost:getAgentHistory', expect.any(Function))
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const handlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        handlers[channel] = handler
      })
      registerCostHandlers()
      return handlers
    }

    const mockEvent = {} as IpcMainInvokeEvent

    it('cost:summary calls getCostSummary', () => {
      const summary = { totalCost: 1.23, agentCount: 5 }
      vi.mocked(getCostSummary).mockReturnValue(summary as any)
      const handlers = captureHandlers()

      const result = handlers['cost:summary'](mockEvent)

      expect(getCostSummary).toHaveBeenCalledTimes(1)
      expect(result).toBe(summary)
    })

    it('cost:agentRuns calls getRecentAgentRunsWithCost with provided limit', () => {
      const runs = [{ id: 'run-1', cost: 0.5 }]
      vi.mocked(getRecentAgentRunsWithCost).mockReturnValue(runs as any)
      const handlers = captureHandlers()

      const result = handlers['cost:agentRuns'](mockEvent, { limit: 10 })

      expect(getRecentAgentRunsWithCost).toHaveBeenCalledWith(10)
      expect(result).toBe(runs)
    })

    it('cost:agentRuns defaults to limit 20 when not provided', () => {
      vi.mocked(getRecentAgentRunsWithCost).mockReturnValue([])
      const handlers = captureHandlers()

      handlers['cost:agentRuns'](mockEvent, {})

      expect(getRecentAgentRunsWithCost).toHaveBeenCalledWith(20)
    })

    it('cost:getAgentHistory calls getAgentHistory with provided limit and offset', () => {
      const history = [{ id: 'run-2', cost: 0.1 }]
      vi.mocked(getAgentHistory).mockReturnValue(history as any)
      const handlers = captureHandlers()

      const result = handlers['cost:getAgentHistory'](mockEvent, { limit: 50, offset: 10 })

      expect(getAgentHistory).toHaveBeenCalledWith(50, 10)
      expect(result).toBe(history)
    })

    it('cost:getAgentHistory defaults to limit 100 and offset 0 when args not provided', () => {
      vi.mocked(getAgentHistory).mockReturnValue([])
      const handlers = captureHandlers()

      handlers['cost:getAgentHistory'](mockEvent, undefined)

      expect(getAgentHistory).toHaveBeenCalledWith(100, 0)
    })

    it('cost:getAgentHistory uses defaults when args is empty object', () => {
      vi.mocked(getAgentHistory).mockReturnValue([])
      const handlers = captureHandlers()

      handlers['cost:getAgentHistory'](mockEvent, {})

      expect(getAgentHistory).toHaveBeenCalledWith(100, 0)
    })
  })
})
