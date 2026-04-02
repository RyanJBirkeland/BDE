/**
 * Window handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => ({ setTitle: vi.fn() }))
  },
  ipcMain: {
    on: vi.fn()
  }
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

import { registerWindowHandlers } from '../window-handlers'
import { safeHandle } from '../../ipc-utils'
import { ipcMain, shell } from 'electron'

describe('Window handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers 1 safeHandle channel and 1 ipcMain.on listener', () => {
    registerWindowHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(1)
    expect(safeHandle).toHaveBeenCalledWith('window:openExternal', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('window:setTitle', expect.any(Function))
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const safeHandlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        safeHandlers[channel] = handler
      })
      registerWindowHandlers()
      return safeHandlers
    }

    const mockEvent = {} as IpcMainInvokeEvent

    describe('window:openExternal', () => {
      it('opens https URLs', async () => {
        const handlers = captureHandlers()

        await handlers['window:openExternal'](mockEvent, 'https://example.com')

        expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
      })

      it('opens http URLs', async () => {
        const handlers = captureHandlers()

        await handlers['window:openExternal'](mockEvent, 'http://example.com')

        expect(shell.openExternal).toHaveBeenCalledWith('http://example.com')
      })

      it('opens mailto URLs', async () => {
        const handlers = captureHandlers()

        await handlers['window:openExternal'](mockEvent, 'mailto:test@example.com')

        expect(shell.openExternal).toHaveBeenCalledWith('mailto:test@example.com')
      })

      it('blocks non-allowed URL schemes', () => {
        const handlers = captureHandlers()

        expect(() => handlers['window:openExternal'](mockEvent, 'file:///etc/passwd')).toThrow(
          'Blocked URL scheme: "file:"'
        )

        expect(shell.openExternal).not.toHaveBeenCalled()
      })

      it('blocks javascript: scheme', () => {
        const handlers = captureHandlers()

        expect(() => handlers['window:openExternal'](mockEvent, 'javascript:alert(1)')).toThrow(
          'Blocked URL scheme: "javascript:"'
        )

        expect(shell.openExternal).not.toHaveBeenCalled()
      })
    })
  })
})
