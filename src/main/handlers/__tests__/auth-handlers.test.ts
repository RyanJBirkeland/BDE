/**
 * Auth handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('../../auth-guard', () => ({
  checkAuthStatus: vi.fn(),
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
}))

import { registerAuthHandlers } from '../auth-handlers'
import { safeHandle } from '../../ipc-utils'
import { checkAuthStatus } from '../../auth-guard'

describe('Auth handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the auth:status channel', () => {
    registerAuthHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(1)
    expect(safeHandle).toHaveBeenCalledWith('auth:status', expect.any(Function))
  })

  it('auth:status handler returns formatted status', async () => {
    let authStatusHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'auth:status') {
        authStatusHandler = handler
      }
    })

    const expiresAt = new Date('2026-12-01T00:00:00.000Z')
    vi.mocked(checkAuthStatus).mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt,
    })

    registerAuthHandlers()

    expect(authStatusHandler).toBeDefined()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await authStatusHandler(mockEvent)

    expect(result).toEqual({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt: expiresAt.toISOString(),
    })
  })

  it('auth:status handler returns undefined expiresAt when not present', async () => {
    let authStatusHandler: any

    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      if (channel === 'auth:status') {
        authStatusHandler = handler
      }
    })

    vi.mocked(checkAuthStatus).mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: true,
      expiresAt: undefined,
    })

    registerAuthHandlers()

    const mockEvent = {} as IpcMainInvokeEvent
    const result = await authStatusHandler(mockEvent)

    expect(result).toEqual({
      cliFound: false,
      tokenFound: false,
      tokenExpired: true,
      expiresAt: undefined,
    })
  })
})
