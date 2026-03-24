/**
 * Agent manager handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
}))

import { registerAgentManagerHandlers } from '../agent-manager-handlers'
import { safeHandle } from '../../ipc-utils'

describe('Agent manager handlers', () => {
  const mockEvent = {} as IpcMainInvokeEvent

  beforeEach(() => {
    vi.clearAllMocks()
    delete (global as any).__agentManager
  })

  it('registers all 2 agent-manager channels', () => {
    registerAgentManagerHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(2)
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:status', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:kill', expect.any(Function))
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const handlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        handlers[channel] = handler
      })
      registerAgentManagerHandlers()
      return handlers
    }

    describe('agent-manager:status', () => {
      it('returns running=false when __agentManager is not set', async () => {
        const handlers = captureHandlers()

        const result = await handlers['agent-manager:status'](mockEvent)

        expect(result).toEqual({ running: false, concurrency: null, activeAgents: [] })
      })

      it('returns status from __agentManager when available', async () => {
        const mockStatus = {
          running: true,
          concurrency: { maxSlots: 3, activeCount: 1 },
          activeAgents: [{ id: 'agent-1' }],
        }
        ;(global as any).__agentManager = {
          getStatus: vi.fn().mockReturnValue(mockStatus),
        }
        const handlers = captureHandlers()

        const result = await handlers['agent-manager:status'](mockEvent)

        expect((global as any).__agentManager.getStatus).toHaveBeenCalledTimes(1)
        expect(result).toBe(mockStatus)
      })
    })

    describe('agent-manager:kill', () => {
      it('throws when __agentManager is not set', async () => {
        const handlers = captureHandlers()

        await expect(handlers['agent-manager:kill'](mockEvent, 'task-123')).rejects.toThrow(
          'Agent manager not available'
        )
      })

      it('calls killAgent and returns ok:true when agent manager is available', async () => {
        const mockKillAgent = vi.fn()
        ;(global as any).__agentManager = {
          killAgent: mockKillAgent,
        }
        const handlers = captureHandlers()

        const result = await handlers['agent-manager:kill'](mockEvent, 'task-123')

        expect(mockKillAgent).toHaveBeenCalledWith('task-123')
        expect(result).toEqual({ ok: true })
      })
    })
  })
})
