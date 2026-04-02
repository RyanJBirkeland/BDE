import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted state — must be defined before vi.mock calls which are hoisted
// ---------------------------------------------------------------------------

const {
  ipcHandlers,
  ipcOnListeners,
  ipcOnceListeners,
  createdWindows,
  mockIpcMain,
  MockBrowserWindow
} = vi.hoisted(() => {
  const ipcHandlers = new Map<string, Function>()
  const ipcOnListeners = new Map<string, Function[]>()
  const ipcOnceListeners = new Map<string, Function>()
  const createdWindows: any[] = []

  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: Function) => {
      ipcHandlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: Function) => {
      const existing = ipcOnListeners.get(channel) ?? []
      ipcOnListeners.set(channel, [...existing, handler])
    }),
    once: vi.fn((channel: string, handler: Function) => {
      ipcOnceListeners.set(channel, handler)
    }),
    removeAllListeners: vi.fn((channel: string) => {
      ipcOnceListeners.delete(channel)
    })
  }

  class MockBrowserWindow {
    id: number
    webContents: { send: any; setWindowOpenHandler: any }
    isDestroyed: any
    show: any
    destroy: any
    getBounds: any
    loadURL: any
    loadFile: any
    opts: Record<string, unknown>

    _listeners: Map<string, Function[]> = new Map()
    _destroyed = false

    static nextId = 1
    static getAllWindows = vi.fn(() => createdWindows.filter((w: any) => !w._destroyed))

    constructor(opts: Record<string, unknown>) {
      this.opts = opts
      this.id = MockBrowserWindow.nextId++
      this.webContents = {
        send: vi.fn(),
        setWindowOpenHandler: vi.fn()
      }
      this.isDestroyed = vi.fn(() => this._destroyed)
      this.show = vi.fn()
      this.destroy = vi.fn(() => {
        this._destroyed = true
      })
      this.getBounds = vi.fn(() => ({ x: 0, y: 0, width: 900, height: 700 }))
      this.loadURL = vi.fn()
      this.loadFile = vi.fn()

      createdWindows.push(this)
    }

    on(event: string, handler: Function): this {
      const existing = this._listeners.get(event) ?? []
      this._listeners.set(event, [...existing, handler])
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this._listeners.get(event) ?? []) {
        handler(...args)
      }
    }
  }

  return {
    ipcHandlers,
    ipcOnListeners,
    ipcOnceListeners,
    createdWindows,
    mockIpcMain,
    MockBrowserWindow
  }
})

// ---------------------------------------------------------------------------
// Electron mock
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

// ---------------------------------------------------------------------------
// Settings mock
// ---------------------------------------------------------------------------

const { mockGetSetting, mockGetSettingJson, mockSetSettingJson } = vi.hoisted(() => ({
  mockGetSetting: vi.fn().mockReturnValue(null),
  mockGetSettingJson: vi.fn().mockReturnValue(null),
  mockSetSettingJson: vi.fn()
}))

vi.mock('../settings', () => ({
  getSetting: mockGetSetting,
  setSetting: vi.fn(),
  getSettingJson: mockGetSettingJson,
  setSettingJson: mockSetSettingJson
}))

// ---------------------------------------------------------------------------
// Logger mock
// ---------------------------------------------------------------------------

vi.mock('../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

// ---------------------------------------------------------------------------
// Import module under test (after all mocks)
// ---------------------------------------------------------------------------

import {
  registerTearoffHandlers,
  getMainWindow,
  setQuitting,
  closeTearoffWindows,
  SHARED_WEB_PREFERENCES,
  _resetForTest
} from '../tearoff-manager'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  _resetForTest()
  ipcHandlers.clear()
  ipcOnListeners.clear()
  ipcOnceListeners.clear()
  createdWindows.length = 0
  MockBrowserWindow.nextId = 1
  MockBrowserWindow.getAllWindows.mockImplementation(() =>
    createdWindows.filter((w: any) => !w._destroyed)
  )
  mockGetSetting.mockReturnValue(null)
  mockGetSettingJson.mockReturnValue(null)
  mockSetSettingJson.mockReset()
  vi.clearAllMocks()
  // Re-bind mock implementations after clearAllMocks
  mockIpcMain.handle.mockImplementation((channel: string, handler: Function) => {
    ipcHandlers.set(channel, handler)
  })
  mockIpcMain.on.mockImplementation((channel: string, handler: Function) => {
    const existing = ipcOnListeners.get(channel) ?? []
    ipcOnListeners.set(channel, [...existing, handler])
  })
  mockIpcMain.once.mockImplementation((channel: string, handler: Function) => {
    ipcOnceListeners.set(channel, handler)
  })
  mockIpcMain.removeAllListeners.mockImplementation((channel: string) => {
    ipcOnceListeners.delete(channel)
  })
  MockBrowserWindow.getAllWindows.mockImplementation(() =>
    createdWindows.filter((w: any) => !w._destroyed)
  )
}

const fakeEvent = { preventDefault: vi.fn(), sender: { id: 0 } } as unknown as Electron.IpcMainEvent
const fakeInvokeEvent = {} as Electron.IpcMainInvokeEvent

const defaultPayload = {
  view: 'agents',
  screenX: 500,
  screenY: 400,
  sourcePanelId: 'panel-1',
  sourceTabIndex: 0
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SHARED_WEB_PREFERENCES', () => {
  it('has correct shape', () => {
    expect(SHARED_WEB_PREFERENCES).toMatchObject({
      sandbox: false,
      contextIsolation: true
    })
    expect(SHARED_WEB_PREFERENCES.preload).toContain('preload/index.js')
  })
})

describe('registerTearoffHandlers', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('registers tearoff:create handler', () => {
    expect(ipcHandlers.has('tearoff:create')).toBe(true)
  })

  it('registers tearoff:returnToMain listener', () => {
    expect(ipcOnListeners.has('tearoff:returnToMain')).toBe(true)
  })
})

describe('tearoff:create', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('returns a windowId', async () => {
    const handler = ipcHandlers.get('tearoff:create')!
    const result = await handler(fakeInvokeEvent, defaultPayload)
    expect(result).toHaveProperty('windowId')
    expect(typeof result.windowId).toBe('string')
  })

  it('creates a BrowserWindow with correct options', async () => {
    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)
    expect(createdWindows).toHaveLength(1)
    const win = createdWindows[0]
    expect(win.opts).toMatchObject({
      backgroundColor: '#0A0A0A',
      titleBarStyle: 'hiddenInset',
      autoHideMenuBar: true
    })
  })

  it('uses saved size from settings', async () => {
    mockGetSettingJson.mockReturnValue({ width: 1000, height: 750 })
    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)
    expect(createdWindows[0].opts).toMatchObject({ width: 1000, height: 750 })
  })

  it('defaults to 800x600 when no saved size', async () => {
    mockGetSettingJson.mockReturnValue(null)
    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)
    expect(createdWindows[0].opts).toMatchObject({ width: 800, height: 600 })
  })

  it('notifies main window of tab removal', async () => {
    // Create a "main" window before tear-off creation
    const mainWin = new MockBrowserWindow({})
    // mainWin is already pushed to createdWindows by constructor

    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)

    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'tearoff:tabRemoved',
      expect.objectContaining({
        sourcePanelId: 'panel-1',
        sourceTabIndex: 0
      })
    )
  })

  it('loads URL in prod mode via loadFile', async () => {
    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)
    const win = createdWindows[0]
    expect(win.loadFile).toHaveBeenCalled()
    const [filePath, opts] = win.loadFile.mock.calls[0]
    expect(filePath).toContain('index.html')
    expect(opts?.search).toContain('view=agents')
  })
})

describe('close flow', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  async function createTearoff() {
    const handler = ipcHandlers.get('tearoff:create')!
    const result = await handler(fakeInvokeEvent, defaultPayload)
    const win = createdWindows.find((w: any) => w.id === MockBrowserWindow.nextId - 1)!
    return { windowId: result.windowId as string, win }
  }

  it('prevents default on close and sends tearoff:confirmClose to renderer', async () => {
    const { win } = await createTearoff()

    const mockCloseEvent = { preventDefault: vi.fn() }
    win.emit('close', mockCloseEvent)

    expect(mockCloseEvent.preventDefault).toHaveBeenCalled()
    // confirmClose is sent asynchronously — give it a tick
    await new Promise((r) => setImmediate(r))
    expect(win.webContents.send).toHaveBeenCalledWith(
      'tearoff:confirmClose',
      expect.objectContaining({ windowId: expect.any(String) })
    )
  })

  it('action=return sends tearoff:tabReturned to main window', async () => {
    mockGetSetting.mockReturnValue('return')
    const mainWin = new MockBrowserWindow({})

    const { win } = await createTearoff()

    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    // wait for async close flow
    await new Promise((r) => setTimeout(r, 20))

    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'tearoff:tabReturned',
      expect.objectContaining({ windowId: expect.any(String) })
    )
    expect(win.destroy).toHaveBeenCalled()
  })

  it('action=close destroys without sending tabReturned', async () => {
    mockGetSetting.mockReturnValue('close')
    const mainWin = new MockBrowserWindow({})

    const { win } = await createTearoff()

    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    await new Promise((r) => setTimeout(r, 20))

    const returnCalls = mainWin.webContents.send.mock.calls.filter(
      ([ch]: [string]) => ch === 'tearoff:tabReturned'
    )
    expect(returnCalls).toHaveLength(0)
    expect(win.destroy).toHaveBeenCalled()
  })

  it('renderer response with action=return sends tabReturned', async () => {
    // No persisted closeAction — must ask renderer
    mockGetSetting.mockReturnValue(null)

    const mainWin = new MockBrowserWindow({})

    const { win, windowId } = await createTearoff()

    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    // Simulate renderer responding
    await new Promise((r) => setImmediate(r))
    const onceHandler = ipcOnceListeners.get(`tearoff:closeResponse:${windowId}`)
    expect(onceHandler).toBeDefined()
    onceHandler!(fakeEvent, { action: 'return' })

    await new Promise((r) => setTimeout(r, 20))

    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'tearoff:tabReturned',
      expect.objectContaining({ windowId })
    )
    expect(win.destroy).toHaveBeenCalled()
  })

  it('renderer response with action=close destroys window only', async () => {
    mockGetSetting.mockReturnValue(null)

    const mainWin = new MockBrowserWindow({})

    const { win, windowId } = await createTearoff()

    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    await new Promise((r) => setImmediate(r))
    const onceHandler = ipcOnceListeners.get(`tearoff:closeResponse:${windowId}`)!
    onceHandler(fakeEvent, { action: 'close' })

    await new Promise((r) => setTimeout(r, 20))

    const returnCalls = mainWin.webContents.send.mock.calls.filter(
      ([ch]: [string]) => ch === 'tearoff:tabReturned'
    )
    expect(returnCalls).toHaveLength(0)
    expect(win.destroy).toHaveBeenCalled()
  })

  it('5-second timeout force-closes window when no renderer response', async () => {
    vi.useFakeTimers()
    mockGetSetting.mockReturnValue(null)

    const { win } = await createTearoff()

    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    // Advance past 5-second timeout
    await vi.advanceTimersByTimeAsync(6000)

    expect(win.destroy).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('setQuitting', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('allows immediate close without confirmation when quitting', async () => {
    setQuitting()

    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)
    const win = createdWindows[0]

    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    // Should NOT preventDefault — just delete from map and return
    expect(closeEvent.preventDefault).not.toHaveBeenCalled()
    expect(win.webContents.send).not.toHaveBeenCalledWith('tearoff:confirmClose', expect.anything())
  })
})

describe('closeTearoffWindows', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('destroys all tracked tear-off windows', async () => {
    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)
    await handler(fakeInvokeEvent, { ...defaultPayload, view: 'ide' })

    expect(createdWindows).toHaveLength(2)

    closeTearoffWindows()

    for (const win of createdWindows) {
      expect(win.destroy).toHaveBeenCalled()
    }
  })
})

describe('getMainWindow', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('returns the window that is not a tear-off', async () => {
    const mainWin = new MockBrowserWindow({})

    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)

    const found = getMainWindow()
    expect(found).toBe(mainWin)
  })

  it('returns null when no windows exist', () => {
    expect(getMainWindow()).toBeNull()
  })
})

describe('tearoff:returnToMain', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('sends tabReturned to main window and destroys tear-off', async () => {
    const mainWin = new MockBrowserWindow({})

    const handler = ipcHandlers.get('tearoff:create')!
    const { windowId } = await handler(fakeInvokeEvent, defaultPayload)

    const tearoffWin = createdWindows.find((w: any) => w.id !== mainWin.id)!

    const listeners = ipcOnListeners.get('tearoff:returnToMain')!
    expect(listeners).toHaveLength(1)
    listeners[0](fakeEvent, { windowId })

    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'tearoff:tabReturned',
      expect.objectContaining({ windowId, view: 'agents' })
    )
    expect(tearoffWin.destroy).toHaveBeenCalled()
  })
})
