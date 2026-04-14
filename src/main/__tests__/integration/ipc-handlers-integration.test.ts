import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// --- Electron mock: capture ipcMain.handle registrations ---

const handlers = new Map<string, Function>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => handlers.set(channel, handler)),
    on: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([])
  }
}))

// --- Mock auth-guard ---

const { mockCheckAuthStatus } = vi.hoisted(() => ({
  mockCheckAuthStatus: vi.fn()
}))

vi.mock('../../auth-guard', () => ({
  checkAuthStatus: mockCheckAuthStatus
}))

import { registerAuthHandlers } from '../../handlers/auth-handlers'
import { registerAgentManagerHandlers } from '../../handlers/agent-manager-handlers'

// Fake IPC event
const fakeEvent = { sender: {} } as Electron.IpcMainInvokeEvent

/** Invoke a captured IPC handler. */
function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for "${channel}"`)
  return handler(fakeEvent, ...args)
}

describe('IPC handlers integration', () => {
  // ── Auth handlers ──────────────────────────────────────────────────

  describe('auth:status handler', () => {
    beforeAll(() => {
      handlers.clear()
      registerAuthHandlers()
    })

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('registers the auth:status channel', () => {
      expect(handlers.has('auth:status')).toBe(true)
    })

    it('returns correct shape with valid token', async () => {
      const expiresAt = new Date(Date.now() + 3_600_000)
      mockCheckAuthStatus.mockResolvedValue({
        cliFound: true,
        tokenFound: true,
        tokenExpired: false,
        expiresAt
      })

      const result = (await invoke('auth:status')) as {
        cliFound: boolean
        tokenFound: boolean
        tokenExpired: boolean
        expiresAt?: string
      }

      expect(result).toEqual({
        cliFound: true,
        tokenFound: true,
        tokenExpired: false,
        expiresAt: expiresAt.toISOString()
      })
    })

    it('returns correct shape with expired token', async () => {
      mockCheckAuthStatus.mockResolvedValue({
        cliFound: true,
        tokenFound: true,
        tokenExpired: true,
        expiresAt: new Date(Date.now() - 3_600_000)
      })

      const result = (await invoke('auth:status')) as {
        cliFound: boolean
        tokenFound: boolean
        tokenExpired: boolean
        expiresAt?: string
      }

      expect(result.tokenExpired).toBe(true)
      expect(result.expiresAt).toBeDefined()
    })

    it('returns correct shape with no token', async () => {
      mockCheckAuthStatus.mockResolvedValue({
        cliFound: true,
        tokenFound: false,
        tokenExpired: false
      })

      const result = (await invoke('auth:status')) as {
        cliFound: boolean
        tokenFound: boolean
        tokenExpired: boolean
        expiresAt?: string
      }

      expect(result).toEqual({
        cliFound: true,
        tokenFound: false,
        tokenExpired: false,
        expiresAt: undefined
      })
    })

    it('returns cliFound=false when CLI not installed', async () => {
      mockCheckAuthStatus.mockResolvedValue({
        cliFound: false,
        tokenFound: false,
        tokenExpired: false
      })

      const result = (await invoke('auth:status')) as { cliFound: boolean }
      expect(result.cliFound).toBe(false)
    })
  })

  // ── Agent manager handlers ─────────────────────────────────────────

  describe('agent-manager handlers', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('registers agent-manager:status channel', () => {
      handlers.clear()
      registerAgentManagerHandlers(undefined)
      expect(handlers.has('agent-manager:status')).toBe(true)
    })

    it('registers agent-manager:kill channel', () => {
      handlers.clear()
      registerAgentManagerHandlers(undefined)
      expect(handlers.has('agent-manager:kill')).toBe(true)
    })

    it('agent-manager:status returns not-running when AgentManager is undefined', async () => {
      handlers.clear()
      registerAgentManagerHandlers(undefined)

      const result = (await invoke('agent-manager:status')) as {
        running: boolean
        shuttingDown: boolean
        concurrency: unknown
        activeAgents: unknown[]
      }

      expect(result).toMatchObject({
        running: false,
        shuttingDown: false,
        activeAgents: [],
        concurrency: expect.objectContaining({ maxSlots: 0, activeCount: 0 })
      })
    })

    it('agent-manager:status delegates to AgentManager when provided', async () => {
      const mockStatus = {
        running: true,
        shuttingDown: false,
        concurrency: {
          maxSlots: 2,
          capacityAfterBackpressure: 2,
          activeCount: 1,
          recoveryScheduledAt: null,
          consecutiveRateLimits: 0,
          atMinimumCapacity: false
        },
        activeAgents: [
          {
            taskId: 't1',
            agentRunId: 'r1',
            model: 'claude-sonnet-4-5',
            startedAt: 0,
            lastOutputAt: 0,
            rateLimitCount: 0,
            costUsd: 0,
            tokensIn: 0,
            tokensOut: 0
          }
        ]
      }
      handlers.clear()
      registerAgentManagerHandlers({ getStatus: () => mockStatus } as any)

      const result = await invoke('agent-manager:status')
      expect(result).toEqual(mockStatus)
    })

    it('agent-manager:kill delegates to AgentManager when provided', async () => {
      const mockKillAgentFn = vi.fn()
      handlers.clear()
      registerAgentManagerHandlers({ killAgent: mockKillAgentFn } as any)

      const result = await invoke('agent-manager:kill', 'task-123')

      expect(mockKillAgentFn).toHaveBeenCalledWith('task-123')
      expect(result).toEqual({ ok: true })
    })

    it('agent-manager:kill returns error when AgentManager is undefined', async () => {
      handlers.clear()
      registerAgentManagerHandlers(undefined)

      const result = await invoke('agent-manager:kill', 'task-123')

      expect(result).toEqual({ ok: false, error: 'Agent manager not available' })
    })
  })
})
