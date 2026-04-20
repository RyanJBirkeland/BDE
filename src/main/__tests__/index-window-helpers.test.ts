import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'

// Mock electron before importing the module under test
vi.mock('electron', () => ({
  app: {
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined)
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined)
  },
  BrowserWindow: vi.fn(),
  dialog: {
    showErrorBox: vi.fn()
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  electronApp: {
    setAppUserModelId: vi.fn()
  },
  optimizer: {},
  is: {
    dev: false
  }
}))

vi.mock('../bootstrap', () => ({
  emitStartupWarnings: vi.fn(),
  startDbWatcher: vi.fn(),
  initializeDatabase: vi.fn(),
  startBackgroundServices: vi.fn(),
  startPrPollers: vi.fn(),
  setupCleanupTasks: vi.fn(),
  setupCSP: vi.fn()
}))

vi.mock('../renderer-load-retry', () => ({
  attachRendererLoadRetry: vi.fn(),
  MAX_RENDERER_LOAD_RETRIES: 3,
  RENDERER_RETRY_BASE_DELAY_MS: 1000,
  ERR_ABORTED: -3,
  READY_TO_SHOW_FALLBACK_MS: 8000
}))

vi.mock('../env-utils', () => ({
  getOAuthToken: vi.fn(),
  ensureExtraPathsOnProcessEnv: vi.fn()
}))

vi.mock('../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })),
  logError: vi.fn()
}))

vi.mock('../db', () => ({
  getDb: vi.fn(() => ({ close: vi.fn() })),
  closeDb: vi.fn()
}))

vi.mock('undici', () => ({
  ProxyAgent: vi.fn(),
  setGlobalDispatcher: vi.fn()
}))

vi.mock('../tearoff-manager', () => ({
  closeTearoffWindows: vi.fn(),
  setQuitting: vi.fn(),
  SHARED_WEB_PREFERENCES: {},
  restoreTearoffWindows: vi.fn()
}))

vi.mock('../../resources/icon.png?asset', () => ({
  default: '/path/to/icon.png'
}))

describe('Window helper functions', () => {
  let mockWindow: any
  let readyToShowHandler: Function | null = null
  let closedHandler: Function | null = null
  let windowOpenHandler: Function | null = null
  let willNavigateHandler: Function | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    readyToShowHandler = null
    closedHandler = null
    windowOpenHandler = null
    willNavigateHandler = null

    mockWindow = {
      show: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'ready-to-show') readyToShowHandler = handler
        if (event === 'closed') closedHandler = handler
      }),
      webContents: {
        setWindowOpenHandler: vi.fn((handler: Function) => {
          windowOpenHandler = handler
        }),
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'will-navigate') willNavigateHandler = handler
        })
      }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('resolveAppUrl', () => {
    it('returns file URL in production mode', async () => {
      vi.doMock('@electron-toolkit/utils', () => ({
        is: { dev: false }
      }))
      // Reset modules to pick up the new mock
      vi.resetModules()
      const { resolveAppUrl } = await import('../index')
      const url = resolveAppUrl()
      expect(url).toMatch(/^file:\/\/.*\/renderer\/index\.html$/)
    })

    it('returns ELECTRON_RENDERER_URL in dev mode when set', async () => {
      const testUrl = 'http://localhost:5173'
      process.env.ELECTRON_RENDERER_URL = testUrl
      vi.doMock('@electron-toolkit/utils', () => ({
        is: { dev: true }
      }))
      vi.resetModules()
      const { resolveAppUrl } = await import('../index')
      const url = resolveAppUrl()
      expect(url).toBe(testUrl)
      delete process.env.ELECTRON_RENDERER_URL
    })

    it('returns file URL in dev mode when ELECTRON_RENDERER_URL not set', async () => {
      delete process.env.ELECTRON_RENDERER_URL
      vi.doMock('@electron-toolkit/utils', () => ({
        is: { dev: true }
      }))
      vi.resetModules()
      const { resolveAppUrl } = await import('../index')
      const url = resolveAppUrl()
      expect(url).toMatch(/^file:\/\/.*\/renderer\/index\.html$/)
    })
  })

  describe('installReadyToShowFallback', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows window on ready-to-show event', async () => {
      vi.resetModules()
      const { installReadyToShowFallback } = await import('../index')
      const { emitStartupWarnings } = await import('../bootstrap')

      installReadyToShowFallback(mockWindow as unknown as BrowserWindow)

      expect(mockWindow.on).toHaveBeenCalledWith('ready-to-show', expect.any(Function))
      expect(readyToShowHandler).not.toBeNull()

      // Trigger ready-to-show
      readyToShowHandler!()

      expect(mockWindow.show).toHaveBeenCalledTimes(1)
      expect(emitStartupWarnings).toHaveBeenCalledTimes(1)
    })

    it('shows window after timeout if ready-to-show does not fire', async () => {
      vi.resetModules()
      const { installReadyToShowFallback } = await import('../index')
      const { emitStartupWarnings } = await import('../bootstrap')
      const { READY_TO_SHOW_FALLBACK_MS } = await import('../renderer-load-retry')

      installReadyToShowFallback(mockWindow as unknown as BrowserWindow)

      expect(mockWindow.show).not.toHaveBeenCalled()

      // Fast-forward past the fallback timeout
      vi.advanceTimersByTime(READY_TO_SHOW_FALLBACK_MS)

      expect(mockWindow.show).toHaveBeenCalledTimes(1)
      expect(emitStartupWarnings).toHaveBeenCalledTimes(1)
    })

    it('does not show window twice if ready-to-show fires before timeout', async () => {
      vi.resetModules()
      const { installReadyToShowFallback } = await import('../index')
      const { READY_TO_SHOW_FALLBACK_MS } = await import('../renderer-load-retry')

      installReadyToShowFallback(mockWindow as unknown as BrowserWindow)

      // Trigger ready-to-show before timeout
      readyToShowHandler!()
      expect(mockWindow.show).toHaveBeenCalledTimes(1)

      // Fast-forward past timeout
      vi.advanceTimersByTime(READY_TO_SHOW_FALLBACK_MS)

      // Should still be called only once
      expect(mockWindow.show).toHaveBeenCalledTimes(1)
    })

    it('clears fallback timer when window is closed', async () => {
      vi.resetModules()
      const { installReadyToShowFallback } = await import('../index')

      installReadyToShowFallback(mockWindow as unknown as BrowserWindow)

      expect(mockWindow.on).toHaveBeenCalledWith('closed', expect.any(Function))
      expect(closedHandler).not.toBeNull()

      // Trigger closed event
      closedHandler!()

      // Timer should be cleared, so advancing time should not show window
      vi.advanceTimersByTime(10000)
      expect(mockWindow.show).not.toHaveBeenCalled()
    })

    it('does not call show() on a destroyed window when timer fires', async () => {
      vi.resetModules()
      const { installReadyToShowFallback } = await import('../index')
      const { READY_TO_SHOW_FALLBACK_MS } = await import('../renderer-load-retry')

      mockWindow.isDestroyed = vi.fn(() => true)

      installReadyToShowFallback(mockWindow as unknown as BrowserWindow)

      vi.advanceTimersByTime(READY_TO_SHOW_FALLBACK_MS)

      expect(mockWindow.show).not.toHaveBeenCalled()
    })

    it('does not call show() on a destroyed window when ready-to-show fires', async () => {
      vi.resetModules()
      const { installReadyToShowFallback } = await import('../index')

      mockWindow.isDestroyed = vi.fn(() => true)

      installReadyToShowFallback(mockWindow as unknown as BrowserWindow)

      readyToShowHandler!()

      expect(mockWindow.show).not.toHaveBeenCalled()
    })
  })

  describe('installExternalLinkHandler', () => {
    it('opens external links with allowed schemes', async () => {
      vi.resetModules()
      const { installExternalLinkHandler } = await import('../index')
      const { shell } = await import('electron')

      installExternalLinkHandler(mockWindow as unknown as BrowserWindow)

      expect(windowOpenHandler).not.toBeNull()

      const result = windowOpenHandler!({ url: 'https://example.com' })

      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
      expect(result).toEqual({ action: 'deny' })
    })

    it('does not open links with disallowed schemes', async () => {
      vi.resetModules()
      const { installExternalLinkHandler } = await import('../index')
      const { shell } = await import('electron')

      installExternalLinkHandler(mockWindow as unknown as BrowserWindow)

      const result = windowOpenHandler!({ url: 'file:///etc/passwd' })

      expect(shell.openExternal).not.toHaveBeenCalled()
      expect(result).toEqual({ action: 'deny' })
    })

    it('handles malformed URLs gracefully', async () => {
      vi.resetModules()
      const { installExternalLinkHandler } = await import('../index')

      installExternalLinkHandler(mockWindow as unknown as BrowserWindow)

      const result = windowOpenHandler!({ url: 'not a url' })

      expect(result).toEqual({ action: 'deny' })
    })

    it('always denies popup windows', async () => {
      vi.resetModules()
      const { installExternalLinkHandler } = await import('../index')

      installExternalLinkHandler(mockWindow as unknown as BrowserWindow)

      const result = windowOpenHandler!({ url: 'https://example.com' })

      expect(result).toEqual({ action: 'deny' })
    })
  })

  describe('installNavigationGuard', () => {
    it('allows navigation to app URL', async () => {
      vi.resetModules()
      const { installNavigationGuard } = await import('../index')

      const appUrl = 'http://localhost:5173'
      installNavigationGuard(mockWindow as unknown as BrowserWindow, appUrl)

      expect(willNavigateHandler).not.toBeNull()

      const mockEvent = { preventDefault: vi.fn() }
      willNavigateHandler!(mockEvent, 'http://localhost:5173/some/path')

      expect(mockEvent.preventDefault).not.toHaveBeenCalled()
    })

    it('prevents navigation to external URLs', async () => {
      vi.resetModules()
      const { installNavigationGuard } = await import('../index')

      const appUrl = 'http://localhost:5173'
      installNavigationGuard(mockWindow as unknown as BrowserWindow, appUrl)

      const mockEvent = { preventDefault: vi.fn() }
      willNavigateHandler!(mockEvent, 'https://evil.com')

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1)
    })

    it('prevents navigation to different origin with same scheme', async () => {
      vi.resetModules()
      const { installNavigationGuard } = await import('../index')

      const appUrl = 'http://localhost:5173'
      installNavigationGuard(mockWindow as unknown as BrowserWindow, appUrl)

      const mockEvent = { preventDefault: vi.fn() }
      willNavigateHandler!(mockEvent, 'http://localhost:8080/path')

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1)
    })
  })
})
