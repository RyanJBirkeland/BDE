/**
 * Window handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue('')
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => ({ setTitle: vi.fn() }))
  },
  ipcMain: {
    on: vi.fn()
  }
}))

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn()
}))

vi.mock('os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
  homedir: vi.fn().mockReturnValue('/home/test')
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
  safeOn: vi.fn()
}))

vi.mock('../../lib/review-paths', () => ({
  validateWorktreePath: vi.fn()
}))

import { registerWindowHandlers } from '../window-handlers'
import { safeHandle, safeOn } from '../../ipc-utils'
import { shell } from 'electron'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { validateWorktreePath } from '../../lib/review-paths'

describe('Window handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers 4 safeHandle channels and 1 safeOn channel', () => {
    registerWindowHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(4)
    expect(safeHandle).toHaveBeenCalledWith('window:openExternal', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('window:openPath', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('playground:sanitize', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('playground:openInBrowser', expect.any(Function))
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const safeHandlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        safeHandlers[channel] = handler
      })
      vi.mocked(safeOn).mockImplementation((channel, handler) => {
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

    describe('playground:sanitize', () => {
      it('returns sanitized HTML string', () => {
        const handlers = captureHandlers()
        const html = '<h1 onclick="alert(1)">Hello</h1>'
        const result = handlers['playground:sanitize'](mockEvent, html)
        // DOMPurify should strip the event handler
        expect(typeof result).toBe('string')
        expect(result).toContain('<h1>')
        expect(result).not.toContain('onclick')
      })

      it('strips script tags', () => {
        const handlers = captureHandlers()
        const html = '<p>safe</p><script>alert("xss")</script>'
        const result = handlers['playground:sanitize'](mockEvent, html)
        expect(result).toContain('<p>')
        expect(result).not.toContain('<script>')
      })
    })

    describe('window:openPath', () => {
      it('calls validateWorktreePath then shell.openPath for a valid path', async () => {
        const handlers = captureHandlers()
        const worktreePath = '/home/test/.fleet/worktrees/fleet/abc123'
        vi.mocked(validateWorktreePath).mockReturnValue(undefined)

        await handlers['window:openPath'](mockEvent, worktreePath)

        expect(validateWorktreePath).toHaveBeenCalledWith(worktreePath)
        expect(shell.openPath).toHaveBeenCalledWith(worktreePath)
      })

      it('rejects when validateWorktreePath rejects the path', async () => {
        const handlers = captureHandlers()
        vi.mocked(validateWorktreePath).mockImplementation(() => {
          throw new Error('Invalid worktree path: "/etc" is not inside an allowed worktree base')
        })

        await expect(handlers['window:openPath'](mockEvent, '/etc')).rejects.toThrow(
          'Invalid worktree path'
        )
        expect(shell.openPath).not.toHaveBeenCalled()
      })
    })

    describe('playground:openInBrowser', () => {
      it('sanitizes HTML before writing to temp file', async () => {
        vi.mocked(tmpdir).mockReturnValue('/tmp')

        const handlers = captureHandlers()
        const dirtyHtml = '<h1 onclick="xss()">Test</h1><script>alert("xss")</script>'

        const result = await handlers['playground:openInBrowser'](mockEvent, dirtyHtml)

        expect(writeFileSync).toHaveBeenCalledOnce()
        const writeCall = vi.mocked(writeFileSync).mock.calls[0]
        expect(writeCall[0]).toMatch(/^\/tmp\/fleet-playground-[0-9a-f]+\.html$/)

        // Verify sanitization: dirty HTML is cleaned before writing
        const writtenHtml = writeCall[1] as string
        expect(writtenHtml).toContain('<h1>')
        expect(writtenHtml).not.toContain('onclick')
        expect(writtenHtml).not.toContain('<script>')
        expect(writeCall[2]).toBe('utf-8')

        expect(shell.openPath).toHaveBeenCalledOnce()
        const openCall = vi.mocked(shell.openPath).mock.calls[0]
        expect(openCall[0]).toMatch(/^\/tmp\/fleet-playground-[0-9a-f]+\.html$/)

        expect(result).toMatch(/^\/tmp\/fleet-playground-[0-9a-f]+\.html$/)
      })
    })
  })
})
