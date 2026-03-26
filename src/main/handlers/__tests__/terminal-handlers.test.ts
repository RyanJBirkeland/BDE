/**
 * Terminal handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

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
  safeHandle: vi.fn()
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
import { safeHandle } from '../../ipc-utils'
import { ipcMain, BrowserWindow } from 'electron'
import { isPtyAvailable, validateShell, createPty } from '../../pty'

// Shared mock objects — defined after imports so they are available at test time
const mockWebContents = { send: vi.fn() }
const mockWindow = { id: 42, webContents: mockWebContents }

/** Build a mock PtyHandle whose callbacks can be triggered manually. */
function makeMockPtyHandle() {
  let dataCallback: ((d: string) => void) | undefined
  let exitCallback: (() => void) | undefined

  const handle = {
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

/** Capture the safeHandle handler for a given channel after registering all handlers. */
function captureHandlers(): Record<string, (...args: any[]) => any> {
  const handlers: Record<string, (...args: any[]) => any> = {}
  vi.mocked(safeHandle).mockImplementation((channel, handler) => {
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
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow as any)
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as any])
    // Re-attach send spy after clearAllMocks
    mockWebContents.send = vi.fn()
  })

  it('registers 3 safeHandle channels and 1 ipcMain.on listener', () => {
    registerTerminalHandlers()
    expect(safeHandle).toHaveBeenCalledTimes(3)
    expect(safeHandle).toHaveBeenCalledWith('terminal:create', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('terminal:resize', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('terminal:kill', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('terminal:write', expect.any(Function))
  })

  describe('terminal:create', () => {
    it('returns a numeric terminal id', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      expect(typeof id).toBe('number')
      expect(id).toBeGreaterThan(0)
    })

    it('increments id on each call', () => {
      vi.mocked(createPty).mockImplementation(() => makeMockPtyHandle() as any)
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
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      mockHandle._triggerData('hello world')

      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:data:${id}`, 'hello world')
    })

    it('sends terminal:exit:<id> to the window and cleans up on pty exit', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      mockHandle._triggerExit()

      expect(mockWebContents.send).toHaveBeenCalledWith(`terminal:exit:${id}`)
    })

    it('uses process.env.SHELL as default shell when none provided', () => {
      const originalShell = process.env.SHELL
      process.env.SHELL = '/bin/zsh'
      vi.mocked(createPty).mockImplementation(() => makeMockPtyHandle() as any)
      const handlers = captureHandlers()

      handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      expect(createPty).toHaveBeenCalledWith(expect.objectContaining({ shell: '/bin/zsh' }))
      process.env.SHELL = originalShell
    })
  })

  describe('terminal:write (ipcMain.on)', () => {
    it('writes data to the terminal if it exists', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      // Create a terminal first
      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      // Capture the ipcMain.on handler
      const writeListener = vi
        .mocked(ipcMain.on)
        .mock.calls.find(([ch]) => ch === 'terminal:write')?.[1] as
        | ((_e: any, args: any) => void)
        | undefined
      expect(writeListener).toBeDefined()

      writeListener!({} as any, { id, data: 'ls -la\n' })
      expect(mockHandle.write).toHaveBeenCalledWith('ls -la\n')
    })

    it('silently ignores writes to unknown terminal ids', () => {
      captureHandlers()

      const writeListener = vi
        .mocked(ipcMain.on)
        .mock.calls.find(([ch]) => ch === 'terminal:write')?.[1] as
        | ((_e: any, args: any) => void)
        | undefined

      expect(() => writeListener!({} as any, { id: 9999, data: 'hello' })).not.toThrow()
    })

    it('silently ignores data that exceeds 65536 bytes', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      const writeListener = vi
        .mocked(ipcMain.on)
        .mock.calls.find(([ch]) => ch === 'terminal:write')?.[1] as
        | ((_e: any, args: any) => void)
        | undefined

      const oversized = 'x'.repeat(65_537)
      writeListener!({} as any, { id, data: oversized })
      expect(mockHandle.write).not.toHaveBeenCalled()
    })

    it('silently ignores non-string data', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })

      const writeListener = vi
        .mocked(ipcMain.on)
        .mock.calls.find(([ch]) => ch === 'terminal:write')?.[1] as
        | ((_e: any, args: any) => void)
        | undefined

      writeListener!({} as any, { id, data: 42 })
      expect(mockHandle.write).not.toHaveBeenCalled()
    })
  })

  describe('terminal:resize', () => {
    it('resizes an existing terminal', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:resize']({} as IpcMainInvokeEvent, { id, cols: 120, rows: 40 })

      expect(mockHandle.resize).toHaveBeenCalledWith(120, 40)
    })

    it('does nothing for an unknown terminal id', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
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
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:kill']({} as IpcMainInvokeEvent, id)

      expect(mockHandle.kill).toHaveBeenCalled()
    })

    it('does nothing for an unknown terminal id', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      expect(() => handlers['terminal:kill']({} as IpcMainInvokeEvent, 9999)).not.toThrow()
      expect(mockHandle.kill).not.toHaveBeenCalled()
    })

    it('terminal no longer responds to resize after kill', () => {
      const mockHandle = makeMockPtyHandle()
      vi.mocked(createPty).mockReturnValue(mockHandle as any)
      const handlers = captureHandlers()

      const id = handlers['terminal:create'](mockEvent, { cols: 80, rows: 24 })
      handlers['terminal:kill']({} as IpcMainInvokeEvent, id)
      handlers['terminal:resize']({} as IpcMainInvokeEvent, { id, cols: 200, rows: 50 })

      expect(mockHandle.resize).not.toHaveBeenCalled()
    })
  })
})
