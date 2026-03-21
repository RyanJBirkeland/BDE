import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// --- Electron mock: capture ipcMain.handle registrations ---

const handlers = new Map<string, Function>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => handlers.set(channel, handler)),
    on: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}))

// --- Mock auth-guard ---

const { mockCheckAuthStatus } = vi.hoisted(() => ({
  mockCheckAuthStatus: vi.fn(),
}))

vi.mock('../../auth-guard', () => ({
  checkAuthStatus: mockCheckAuthStatus,
}))

import { registerAuthHandlers } from '../../handlers/auth-handlers'
import { registerAgentManagerHandlers } from '../../handlers/agent-manager-handlers'
import type { AgentManager } from '../../agent-manager/agent-manager'

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
        expiresAt,
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
        expiresAt: expiresAt.toISOString(),
      })
    })

    it('returns correct shape with expired token', async () => {
      mockCheckAuthStatus.mockResolvedValue({
        cliFound: true,
        tokenFound: true,
        tokenExpired: true,
        expiresAt: new Date(Date.now() - 3_600_000),
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
        tokenExpired: false,
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
        expiresAt: undefined,
      })
    })

    it('returns cliFound=false when CLI not installed', async () => {
      mockCheckAuthStatus.mockResolvedValue({
        cliFound: false,
        tokenFound: false,
        tokenExpired: false,
      })

      const result = (await invoke('auth:status')) as { cliFound: boolean }
      expect(result.cliFound).toBe(false)
    })
  })

  // ── Agent manager handlers ─────────────────────────────────────────

  describe('agent-manager handlers', () => {
    let mockManager: {
      activeCount: number
      availableSlots: number
      killAgent: ReturnType<typeof vi.fn>
    }

    beforeAll(() => {
      handlers.clear()
      mockManager = {
        activeCount: 2,
        availableSlots: 1,
        killAgent: vi.fn(),
      }
      registerAgentManagerHandlers(mockManager as unknown as AgentManager)
    })

    beforeEach(() => {
      vi.clearAllMocks()
      mockManager.activeCount = 2
      mockManager.availableSlots = 1
    })

    it('registers agent-manager:status channel', () => {
      expect(handlers.has('agent-manager:status')).toBe(true)
    })

    it('registers agent-manager:kill channel', () => {
      expect(handlers.has('agent-manager:kill')).toBe(true)
    })

    it('agent-manager:status returns { activeCount, availableSlots }', async () => {
      const result = (await invoke('agent-manager:status')) as {
        activeCount: number
        availableSlots: number
      }

      expect(result).toEqual({
        activeCount: 2,
        availableSlots: 1,
      })
    })

    it('agent-manager:status reflects changing active count', async () => {
      mockManager.activeCount = 0
      mockManager.availableSlots = 3

      const result = (await invoke('agent-manager:status')) as {
        activeCount: number
        availableSlots: number
      }

      expect(result).toEqual({
        activeCount: 0,
        availableSlots: 3,
      })
    })

    it('agent-manager:kill with valid taskId returns true', async () => {
      mockManager.killAgent.mockReturnValue(true)

      const result = await invoke('agent-manager:kill', 'task-123')

      expect(mockManager.killAgent).toHaveBeenCalledWith('task-123')
      expect(result).toBe(true)
    })

    it('agent-manager:kill with invalid taskId returns false', async () => {
      mockManager.killAgent.mockReturnValue(false)

      const result = await invoke('agent-manager:kill', 'nonexistent')

      expect(mockManager.killAgent).toHaveBeenCalledWith('nonexistent')
      expect(result).toBe(false)
    })
  })
})
