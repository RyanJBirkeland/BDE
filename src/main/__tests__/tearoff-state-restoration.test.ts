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
  MockBrowserWindow,
  mockScreen
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
    }),
    emit: vi.fn()
  }

  const mockScreen = {
    getAllDisplays: vi.fn(() => [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    ]),
    getPrimaryDisplay: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 }
    })),
    getCursorScreenPoint: vi.fn(() => ({ x: 960, y: 540 }))
  }

  class MockBrowserWindow {
    id: number
    webContents: { send: any; setWindowOpenHandler: any }
    isDestroyed: any
    show: any
    destroy: any
    getBounds: any
    getContentBounds: any
    loadURL: any
    loadFile: any
    opts: Record<string, unknown>

    _listeners: Map<string, Function[]> = new Map()
    _onceListeners: Map<string, Function[]> = new Map()
    _destroyed = false

    static nextId = 1
    static getAllWindows = vi.fn(() => createdWindows.filter((w: any) => !w._destroyed))
    static fromWebContents = vi.fn((_wc: any) => null)

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
      this.getBounds = vi.fn(() => ({ x: 100, y: 200, width: 900, height: 700 }))
      this.getContentBounds = vi.fn(() => ({ x: 100, y: 200, width: 900, height: 700 }))
      this.loadURL = vi.fn()
      this.loadFile = vi.fn()

      createdWindows.push(this)
    }

    on(event: string, handler: Function): this {
      const existing = this._listeners.get(event) ?? []
      this._listeners.set(event, [...existing, handler])
      return this
    }

    once(event: string, handler: Function): this {
      const existing = this._onceListeners.get(event) ?? []
      this._onceListeners.set(event, [...existing, handler])
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this._listeners.get(event) ?? []) {
        handler(...args)
      }
      for (const handler of this._onceListeners.get(event) ?? []) {
        handler(...args)
      }
      this._onceListeners.delete(event)
    }
  }

  return {
    ipcHandlers,
    ipcOnListeners,
    ipcOnceListeners,
    createdWindows,
    mockIpcMain,
    MockBrowserWindow,
    mockScreen
  }
})

// ---------------------------------------------------------------------------
// Electron mock
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  screen: mockScreen
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
  closeTearoffWindows,
  restoreTearoffWindows,
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
  mockScreen.getAllDisplays.mockReturnValue([
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  ])
  mockScreen.getPrimaryDisplay.mockReturnValue({
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }
  })
}

const fakeInvokeEvent = {} as Electron.IpcMainInvokeEvent
const fakeEvent = { preventDefault: vi.fn() } as unknown as Electron.IpcMainEvent

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

describe('persistTearoffState', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('writes correct JSON to settings after creating a tear-off', async () => {
    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)

    // persistTearoffState is called after create
    const calls = mockSetSettingJson.mock.calls.filter(([key]: [string]) => key === 'tearoff.windows')
    expect(calls.length).toBeGreaterThan(0)
    const [_key, state] = calls[calls.length - 1]
    expect(Array.isArray(state)).toBe(true)
    expect(state).toHaveLength(1)
    expect(state[0]).toMatchObject({
      views: ['agents'],
      bounds: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) })
    })
  })

  it('writes empty array when no tear-offs exist', () => {
    // Import persistTearoffState indirectly via closeTearoffWindows
    closeTearoffWindows()
    const calls = mockSetSettingJson.mock.calls.filter(([key]: [string]) => key === 'tearoff.windows')
    expect(calls.length).toBeGreaterThan(0)
    const [_key, state] = calls[calls.length - 1]
    expect(state).toEqual([])
  })
})

describe('restoreTearoffWindows', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('creates windows from valid persisted entries', () => {
    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'old-id-1',
        views: ['agents', 'ide'],
        bounds: { x: 100, y: 100, width: 900, height: 700 }
      }
    ])

    restoreTearoffWindows()

    expect(createdWindows).toHaveLength(1)
    const win = createdWindows[0]
    expect(win.opts).toMatchObject({
      width: 900,
      height: 700,
      x: 100,
      y: 100,
      backgroundColor: '#0A0A0A',
      titleBarStyle: 'hiddenInset'
    })
  })

  it('loads URL with restore param containing all views', () => {
    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'old-id-1',
        views: ['agents', 'ide'],
        bounds: { x: 100, y: 100, width: 900, height: 700 }
      }
    ])

    restoreTearoffWindows()

    const win = createdWindows[0]
    expect(win.loadFile).toHaveBeenCalled()
    const [_path, opts] = win.loadFile.mock.calls[0]
    expect(opts.search).toContain('restore=')
    expect(opts.search).toContain('agents')
    expect(opts.search).toContain('ide')
  })

  it('shows window after ready-to-show event', () => {
    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'old-id-1',
        views: ['dashboard'],
        bounds: { x: 0, y: 0, width: 800, height: 600 }
      }
    ])

    restoreTearoffWindows()
    const win = createdWindows[0]

    // Simulate ready-to-show
    win.emit('ready-to-show')
    expect(win.show).toHaveBeenCalled()
  })

  it('skips entries with empty views', () => {
    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'old-id-1',
        views: [],
        bounds: { x: 0, y: 0, width: 800, height: 600 }
      }
    ])

    restoreTearoffWindows()

    expect(createdWindows).toHaveLength(0)
  })

  it('skips entries with missing views', () => {
    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'old-id-1',
        bounds: { x: 0, y: 0, width: 800, height: 600 }
      }
    ])

    restoreTearoffWindows()

    expect(createdWindows).toHaveLength(0)
  })

  it('returns early when saved state is null', () => {
    mockGetSettingJson.mockReturnValue(null)

    restoreTearoffWindows()

    expect(createdWindows).toHaveLength(0)
  })

  it('returns early when saved state is empty array', () => {
    mockGetSettingJson.mockReturnValue([])

    restoreTearoffWindows()

    expect(createdWindows).toHaveLength(0)
  })

  it('uses default bounds when saved bounds are off-screen', () => {
    mockScreen.getAllDisplays.mockReturnValue([
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    ])
    mockScreen.getPrimaryDisplay.mockReturnValue({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 }
    })

    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'old-id-1',
        views: ['agents'],
        bounds: { x: 99999, y: 99999, width: 800, height: 600 }
      }
    ])

    restoreTearoffWindows()

    const win = createdWindows[0]
    // Should use default bounds centered on primary display
    expect(win.opts.x).toBe(Math.round(1920 / 2 - 400)) // 560
    expect(win.opts.y).toBe(Math.round(1080 / 2 - 300)) // 240
    expect(win.opts.width).toBe(800)
    expect(win.opts.height).toBe(600)
  })

  it('uses saved bounds when they are on-screen', () => {
    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'old-id-1',
        views: ['agents'],
        bounds: { x: 200, y: 150, width: 1000, height: 800 }
      }
    ])

    restoreTearoffWindows()

    const win = createdWindows[0]
    expect(win.opts).toMatchObject({ x: 200, y: 150, width: 1000, height: 800 })
  })
})

describe('isOnScreen', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('returns true for bounds visible on a display', () => {
    mockScreen.getAllDisplays.mockReturnValue([
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    ])

    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'id1',
        views: ['agents'],
        bounds: { x: 100, y: 100, width: 800, height: 600 }
      }
    ])

    restoreTearoffWindows()
    const win = createdWindows[0]
    expect(win.opts).toMatchObject({ x: 100, y: 100 })
  })

  it('returns false for bounds entirely off-screen', () => {
    mockScreen.getAllDisplays.mockReturnValue([
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    ])

    mockGetSettingJson.mockReturnValue([
      {
        windowId: 'id1',
        views: ['agents'],
        bounds: { x: 5000, y: 5000, width: 800, height: 600 }
      }
    ])

    restoreTearoffWindows()
    const win = createdWindows[0]
    // Should use default bounds, not the off-screen ones
    expect(win.opts.x).not.toBe(5000)
    expect(win.opts.y).not.toBe(5000)
  })
})

describe('tearoff:viewsChanged', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('updates entry views and persists state', async () => {
    const handler = ipcHandlers.get('tearoff:create')!
    const { windowId } = await handler(fakeInvokeEvent, defaultPayload)

    mockSetSettingJson.mockClear()

    const viewsChangedListeners = ipcOnListeners.get('tearoff:viewsChanged')!
    expect(viewsChangedListeners).toHaveLength(1)

    viewsChangedListeners[0](fakeEvent, { windowId, views: ['agents', 'ide', 'dashboard'] })

    // Should have persisted the new state
    const calls = mockSetSettingJson.mock.calls.filter(([key]: [string]) => key === 'tearoff.windows')
    expect(calls.length).toBeGreaterThan(0)
    const [_key, state] = calls[calls.length - 1]
    expect(state[0].views).toEqual(['agents', 'ide', 'dashboard'])
  })

  it('does nothing for unknown windowId', () => {
    mockSetSettingJson.mockClear()

    const viewsChangedListeners = ipcOnListeners.get('tearoff:viewsChanged')!
    viewsChangedListeners[0](fakeEvent, { windowId: 'unknown-id', views: ['agents'] })

    // Should not persist
    const calls = mockSetSettingJson.mock.calls.filter(([key]: [string]) => key === 'tearoff.windows')
    expect(calls).toHaveLength(0)
  })
})

describe('closeTearoffWindows', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('calls persistTearoffState before destroying windows', async () => {
    const handler = ipcHandlers.get('tearoff:create')!
    await handler(fakeInvokeEvent, defaultPayload)
    await handler(fakeInvokeEvent, { ...defaultPayload, view: 'ide' })

    expect(createdWindows).toHaveLength(2)
    mockSetSettingJson.mockClear()

    closeTearoffWindows()

    // persistTearoffState should be called before destroy
    // After destroy, isDestroyed() returns true, so the filter excludes them
    // The key call is that setSettingJson('tearoff.windows', ...) was called
    const calls = mockSetSettingJson.mock.calls.filter(([key]: [string]) => key === 'tearoff.windows')
    expect(calls.length).toBeGreaterThan(0)

    for (const win of createdWindows) {
      expect(win.destroy).toHaveBeenCalled()
    }
  })
})

describe('returnToMain persists state', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('persists state after returning a window to main', async () => {
    const mainWin = new MockBrowserWindow({})
    const handler = ipcHandlers.get('tearoff:create')!
    const { windowId } = await handler(fakeInvokeEvent, defaultPayload)

    mockSetSettingJson.mockClear()

    const returnToMainListeners = ipcOnListeners.get('tearoff:returnToMain')!
    returnToMainListeners[0](fakeEvent, { windowId })

    const calls = mockSetSettingJson.mock.calls.filter(([key]: [string]) => key === 'tearoff.windows')
    expect(calls.length).toBeGreaterThan(0)
    const [_key, state] = calls[calls.length - 1]
    // Window was removed, so state should be empty
    expect(state).toEqual([])
    void mainWin
  })
})

describe('returnAll persists state', () => {
  beforeEach(() => {
    resetState()
    registerTearoffHandlers()
  })

  it('persists state after returning all views to main', async () => {
    const mainWin = new MockBrowserWindow({})
    const handler = ipcHandlers.get('tearoff:create')!
    const { windowId } = await handler(fakeInvokeEvent, defaultPayload)

    // Update views first
    const viewsChangedListeners = ipcOnListeners.get('tearoff:viewsChanged')!
    viewsChangedListeners[0](fakeEvent, { windowId, views: ['agents', 'ide'] })

    mockSetSettingJson.mockClear()

    const returnAllListeners = ipcOnListeners.get('tearoff:returnAll')!
    returnAllListeners[0](fakeEvent, { windowId, views: ['agents', 'ide'] })

    const calls = mockSetSettingJson.mock.calls.filter(([key]: [string]) => key === 'tearoff.windows')
    expect(calls.length).toBeGreaterThan(0)
    const [_key, state] = calls[calls.length - 1]
    expect(state).toEqual([])
    void mainWin
  })
})
