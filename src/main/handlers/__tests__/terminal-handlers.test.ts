/**
 * Terminal handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent, BrowserWindow, WebContents } from 'electron'
import type { IPty } from 'node-pty'
import type { PtyHandle } from '../../pty'

// --- Mocks must be declared before imports ---

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn()
  },
  ipcMain: {
    on: vi.fn()
  }
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
  safeOn: vi.fn()
}))

// We use _setPty to inject a mock pty rather than vi.mock (CJS require can't be intercepted)
vi.mock('../../pty', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pty')>()
  return {
    ...actual,
    isPtyAvailable: vi.fn().mockReturnValue(true),
    validateShell: vi.fn().mockReturnValue(true),
    createPty: vi.fn(),
    _setPty: actual._setPty
  }
})

import { registerTerminalHandlers } from '../terminal-handlers'
import { safeHandle, safeOn } from '../../ipc-utils'
import { BrowserWindow } from 'electron'
import { isPtyAvailable, validateShell, createPty } from '../../pty'

// Shared mock objects — defined after imports so they are available at test time
const mockWebContents: Partial<WebContents> = { send: vi.fn() }
const mockWindow: Partial<BrowserWindow> = {
  id: 42,
  webContents: mockWebContents as WebContents
}

/** Build a mock PtyHandle whose callbacks can be triggered manually. */
function makeMockPtyHandle(): PtyHandle & {
  _triggerData: (d: string) => void
  _triggerExit: () => void
} {
  let dataCallback: ((d: string) => void) | undefined
  let exitCallback: (() => void) | undefined

  const mockProcess: Partial<IPty> = {
    pid: 12345,
    cols: 80,
    rows: 24
  }

  const handle = {
    process: mockProcess as IPty,
    onData: vi.fn((cb: (data: string) => void) => {
      dataCallback = cb
    }),
    onExit: vi.fn((cb: () => void) => {
      exitCallback = cb
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    // helpers for triggering callbacks in tests
    _triggerData: (d: string) => dataCallback?.(d),
    _triggerExit: () => exitCallback?.()
  }
  return handle
}

const mockEvent = { sender: mockWebContents } as unknown as IpcMainInvokeEvent

/** Capture the safeHandle and safeOn handlers after registering all handlers. */
function captureHandlers(): Record<string, (...args: any[]) => any> {
  const handlers: Record<string, (...args: any[]) => any> = {}
  vi.mocked(safeHandle).mockImplementation((channel, handler) => {
    handlers[channel] = handler as (...args: any[]) => any
  })
  vi.mocked(safeOn).mockImplementation((channel, handler) => {
    handlers[channel] = handler as (...args: any[]) => any
  })
  registerTerminalHandlers()
  return handlers
}

describe('Terminal handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isPtyAvailable).mockReturnValue(true)
    vi.mocked(validateShell).mockReturnValue(true)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as BrowserWindow)
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as BrowserWindow])
    // Re-attach send spy after clearAllMocks
    mockWebContents.send = vi.fn()
  })

  it('registers 3 safeHandle channels and 1 safeOn channel', () => {
    registerTerminalHandlers()
    expect(safeHandle).toHaveBeenCalledTimes(3)
    expect(safeHandle).toHaveBeenCalledWith('terminal:create', expect.any(Function), expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('terminal:resize', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('terminal:kill', expect.any(Function))
    expect(safeOn).toHaveBeenCalledWith('terminal:write', expect.any(Function))
  })

  describe('terminal:create', () => {
    it('returns a numeric terminal id', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      expect(typeof id).toBe('number')
      expect(id).toBeGreaterThan(0)
    })

    it('increments id on each call', () => {
      vi.mocked(createPty).mockImplementation(() => makeMockPtyHandle())
      const handlers = captureHandlers()

      const id1 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const id2 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      expect(id2).toBe(id1 + 1)
    })

    it('throws when pty is unavailable', () => {
      vi.mocked(isPtyAvailable).mockReturnValue(false)
      const handlers = captureHandlers()

      expect(() => handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })).toThrow(
        'Terminal unavailable'
      )
    })

    it('throws when shell is not in allow-list', () => {
      vi.mocked(validateShell).mockReturnValue(false)
      const handlers = captureHandlers()

      expect(() =>
        handlers['terminal:create'](mockEvent, { cols: 80, rows: 24, shell: '/usr/bin/evil' })
      ).toThrow('Shell not allowed')
    })

    it('sends terminal:data:<id> to the window when pty emits data', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      mockHandle._triggerData('hello world')

      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:data:${id}`, 'hello world')
    })

    it('sends terminal:exit:<id> to the window and cleans up on pty exit', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      mockHandle._triggerExit()

      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:exit:${id}`)
    })

    it('uses process.env.SHELL as default shell when none provided', () => {
      const originalShell = process.env.SHELL
      process.env.SHELL = '/bin/zsh'
      vi.mocked(createPty).mockImplementation(() => makeMockPtyHandle())
      const handlers = captureHandlers()

      handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      expect(createPty).toHaveBeenCalledWith(expect.objectContaining({ shell: '/bin/zsh' }))
      process.env.SHELL = originalShell
    })
  })

  describe('terminal:write (ipcMain.on)', () => {
    it('writes data to the terminal if it exists', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      // Create a terminal first
      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      const writeListener = handlers['terminal:write'] as (_e: any, args: any) => void

      writeListener(mockEvent, { id, data: 'ls -la\n' })
      expect(mockHandle.write).toHaveBeenCalledWith('ls -la\n')
    })

    it('silently ignores writes to unknown terminal ids', () => {
      const handlers = captureHandlers()
      const writeListener = handlers['terminal:write'] as (_e: any, args: any) => void

      expect(() => writeListener(mockEvent, { id: 9999, data: 'hello' })).not.toThrow()
    })

    it('silently ignores data that exceeds 65536 bytes', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const writeListener = handlers['terminal:write'] as (_e: any, args: any) => void

      const oversized = 'x'.repeat(65_537)
      writeListener(mockEvent, { id, data: oversized })
      expect(mockHandle.write).not.toHaveBeenCalled()
    })

    it('silently ignores non-string data', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const writeListener = handlers['terminal:write'] as (_e: any, args: any) => void

      writeListener(mockEvent, { id, data: 42 })
      expect(mockHandle.write).not.toHaveBeenCalled()
    })
  })

  describe('terminal:resize', () => {
    it('resizes an existing terminal', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:resize']({} as IpcMainInvokeEvent, { id, cols: 120, rows: 40 })

      expect(mockHandle.resize).toHaveBeenCalledWith(120, 40)
    })

    it('does nothing for an unknown terminal id', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      // Should not throw
      expect(() =>
        handlers['terminal:resize']({} as IpcMainInvokeEvent, { id: 9999, cols: 120, rows: 40 })
      ).not.toThrow()
      expect(mockHandle.resize).not.toHaveBeenCalled()
    })
  })

  describe('terminal:kill', () => {
    it('kills and removes an existing terminal', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:kill']({} as IpcMainInvokeEvent, id)

      expect(mockHandle.kill).toHaveBeenCalled()
    })

    it('does nothing for an unknown terminal id', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      expect(() => handlers['terminal:kill']({} as IpcMainInvokeEvent, 9999)).not.toThrow()
      expect(mockHandle.kill).not.toHaveBeenCalled()
    })

    it('terminal no longer responds to resize after kill', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:kill']({} as IpcMainInvokeEvent, id)
      handlers['terminal:resize']({} as IpcMainInvokeEvent, { id, cols: 200, rows: 50 })

      expect(mockHandle.resize).not.toHaveBeenCalled()
    })

    it('double-kill does not throw', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:kill']({} as IpcMainInvokeEvent, id)
      expect(() => handlers['terminal:kill']({} as IpcMainInvokeEvent, id)).not.toThrow()
      // kill should only be called once (on the first kill; second is no-op because terminal was removed)
      expect(mockHandle.kill).toHaveBeenCalledTimes(1)
    })

    it('write to a killed terminal is silently ignored', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:kill']({} as IpcMainInvokeEvent, id)
      const writeListener = handlers['terminal:write'] as (_e: any, args: any) => void

      expect(() => writeListener(mockEvent, { id, data: 'echo dead' })).not.toThrow()
      expect(mockHandle.write).not.toHaveBeenCalled()
    })
  })

  describe('terminal:create with custom cwd', () => {
    it('passes cwd through to createPty', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      handlers['terminal:create'](mockEvent, { cols: 80, rows: 24, cwd: '/tmp/project' })

      expect(createPty).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/project' }))
    })
  })

  describe('multiple concurrent PTY sessions', () => {
    it('creates independent terminals with unique ids', () => {
      const handle1 = makeMockPtyHandle()
      const handle2 = makeMockPtyHandle()
      const handle3 = makeMockPtyHandle()
      vi.mocked(createPty)
        .mockReturnValueOnce(handle1)
        .mockReturnValueOnce(handle2)
        .mockReturnValueOnce(handle3)
      const handlers = captureHandlers()

      const id1 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const id2 = handlers['terminal:create'](mockEvent, { cols: 120, rows: 40 })
      const id3 = handlers['terminal:create'](mockEvent, { cols: 60, rows: 20 })

      const ids = new Set([id1, id2, id3])
      expect(ids.size).toBe(3)
    })

    it('write targets the correct terminal', () => {
      const handle1 = makeMockPtyHandle()
      const handle2 = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValueOnce(handle1).mockReturnValueOnce(handle2)
      const handlers = captureHandlers()

      const id1 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const id2 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      const writeListener = handlers['terminal:write'] as (_e: any, args: any) => void

      writeListener(mockEvent, { id: id1, data: 'for terminal 1' })
      writeListener(mockEvent, { id: id2, data: 'for terminal 2' })

      expect(handle1.write).toHaveBeenCalledWith('for terminal 1')
      expect(handle1.write).not.toHaveBeenCalledWith('for terminal 2')
      expect(handle2.write).toHaveBeenCalledWith('for terminal 2')
      expect(handle2.write).not.toHaveBeenCalledWith('for terminal 1')
    })

    it('resize targets the correct terminal', () => {
      const handle1 = makeMockPtyHandle()
      const handle2 = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValueOnce(handle1).mockReturnValueOnce(handle2)
      const handlers = captureHandlers()

      const _id1 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const id2 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      handlers['terminal:resize']({} as IpcMainInvokeEvent, { id: id2, cols: 200, rows: 50 })

      expect(handle1.resize).not.toHaveBeenCalled()
      expect(handle2.resize).toHaveBeenCalledWith(200, 50)
    })

    it('killing one terminal does not affect others', () => {
      const handle1 = makeMockPtyHandle()
      const handle2 = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValueOnce(handle1).mockReturnValueOnce(handle2)
      const handlers = captureHandlers()

      const id1 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const id2 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      handlers['terminal:kill']({} as IpcMainInvokeEvent, id1)

      // Terminal 1 killed
      expect(handle1.kill).toHaveBeenCalled()

      // Terminal 2 still usable
      handlers['terminal:resize']({} as IpcMainInvokeEvent, { id: id2, cols: 100, rows: 30 })
      expect(handle2.resize).toHaveBeenCalledWith(100, 30)
      expect(handle2.kill).not.toHaveBeenCalled()
    })

    it('data events route to the correct terminal channel', () => {
      const handle1 = makeMockPtyHandle()
      const handle2 = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValueOnce(handle1).mockReturnValueOnce(handle2)
      const handlers = captureHandlers()

      const id1 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const id2 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      handle1._triggerData('output from 1')
      handle2._triggerData('output from 2')

      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:data:${id1}`, 'output from 1')
      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:data:${id2}`, 'output from 2')
    })

    it('exit events are independent per terminal', () => {
      const handle1 = makeMockPtyHandle()
      const handle2 = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValueOnce(handle1).mockReturnValueOnce(handle2)
      const handlers = captureHandlers()

      const id1 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      const id2 = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      // Exit terminal 1 — terminal 2 should still work
      handle1._triggerExit()

      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:exit:${id1}`)
      expect(mockWebContents.send).not.toHaveBeenCalledWith(`terminal:exit:${id2}`)

      // Terminal 2 can still receive data
      handle2._triggerData('still alive')
      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:data:${id2}`, 'still alive')
    })
  })

  describe('cleanup after pty exit', () => {
    it('resize is a no-op after pty exits naturally', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      mockHandle._triggerExit()

      // Terminal was cleaned up by the exit handler
      handlers['terminal:resize']({} as IpcMainInvokeEvent, { id, cols: 200, rows: 50 })
      expect(mockHandle.resize).not.toHaveBeenCalled()
    })

    it('write is a no-op after pty exits naturally', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      mockHandle._triggerExit()

      const writeListener = handlers['terminal:write'] as (_e: any, args: any) => void

      writeListener(mockEvent, { id, data: 'after exit' })
      expect(mockHandle.write).not.toHaveBeenCalled()
    })

    it('kill after natural exit does not throw', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      mockHandle._triggerExit()

      expect(() => handlers['terminal:kill']({} as IpcMainInvokeEvent, id)).not.toThrow()
      // kill not called because the terminal was already removed by exit cleanup
      expect(mockHandle.kill).not.toHaveBeenCalled()
    })
  })
})
