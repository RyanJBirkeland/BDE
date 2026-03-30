/**
 * tearoff-manager.ts — Main process module for tear-off window lifecycle.
 *
 * Manages creation, close flow (two-phase async with confirmation), bounds
 * persistence, and cleanup of tear-off BrowserWindows.
 */

import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { randomUUID } from 'crypto'
import { getSetting, getSettingJson, setSettingJson } from './settings'
import { createLogger } from './logger'

const logger = createLogger('tearoff-manager')

// ---------------------------------------------------------------------------
// Shared web preferences (matches main window)
// ---------------------------------------------------------------------------

export const SHARED_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface TearoffEntry {
  win: BrowserWindow
  view: string
  windowId: string
}

const tearoffWindows = new Map<string, TearoffEntry>()
let isQuitting = false

// Resize debounce timers per window
const resizeTimers = new Map<string, ReturnType<typeof setTimeout>>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Sets the quitting flag so close handlers skip confirmation dialogs. */
export function setQuitting(): void {
  isQuitting = true
}

/** FOR TESTING ONLY — resets all module-level state between test runs. */
export function _resetForTest(): void {
  tearoffWindows.clear()
  isQuitting = false
  for (const timer of resizeTimers.values()) clearTimeout(timer)
  resizeTimers.clear()
}

/** Destroys all tear-off windows (call on app quit). */
export function closeTearoffWindows(): void {
  for (const entry of tearoffWindows.values()) {
    try {
      entry.win.destroy()
    } catch {
      /* already destroyed */
    }
  }
  tearoffWindows.clear()
}

/** Returns the main BrowserWindow (the one that is NOT a tear-off). */
export function getMainWindow(): BrowserWindow | null {
  const tearoffIds = new Set(
    Array.from(tearoffWindows.values()).map((e) => e.win.id)
  )
  const all = BrowserWindow.getAllWindows()
  return all.find((w) => !tearoffIds.has(w.id)) ?? null
}

// ---------------------------------------------------------------------------
// Window creation helpers
// ---------------------------------------------------------------------------

function loadTearoffUrl(win: BrowserWindow, view: string, windowId: string): void {
  const query = `?view=${encodeURIComponent(view)}&windowId=${encodeURIComponent(windowId)}`

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }
}

function persistBoundsDebounced(windowId: string, win: BrowserWindow): void {
  const existing = resizeTimers.get(windowId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    resizeTimers.delete(windowId)
    const { width, height } = win.getBounds()
    setSettingJson('tearoff.lastSize', { width, height })
  }, 500)

  resizeTimers.set(windowId, timer)
}

async function handleCloseRequest(windowId: string, win: BrowserWindow): Promise<void> {
  // Check persisted preference
  const closeAction = getSetting('tearoff.closeAction') as 'return' | 'close' | null

  const action = closeAction ?? (await askRendererForAction(windowId, win))

  if (action === 'return') {
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('tearoff:tabReturned', { windowId })
    }
  }

  // Remove from map and destroy
  tearoffWindows.delete(windowId)
  clearResizeTimer(windowId)

  try {
    win.destroy()
  } catch {
    /* already destroyed */
  }
}

function askRendererForAction(
  windowId: string,
  win: BrowserWindow
): Promise<'return' | 'close'> {
  return new Promise<'return' | 'close'>((resolve) => {
    const responseChannel = `tearoff:closeResponse:${windowId}`

    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(responseChannel)
      resolve('close')
    }, 5000)

    ipcMain.once(responseChannel, (_event, payload: { action: 'return' | 'close' }) => {
      clearTimeout(timeout)
      resolve(payload?.action ?? 'close')
    })

    win.webContents.send('tearoff:confirmClose', { windowId })
  })
}

function clearResizeTimer(windowId: string): void {
  const timer = resizeTimers.get(windowId)
  if (timer) {
    clearTimeout(timer)
    resizeTimers.delete(windowId)
  }
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerTearoffHandlers(): void {
  // tearoff:create — renderer requests a new tear-off window
  ipcMain.handle(
    'tearoff:create',
    (
      _event,
      payload: {
        view: string
        screenX: number
        screenY: number
        sourcePanelId: string
        sourceTabIndex: number
      }
    ): { windowId: string } => {
      const { view, screenX, screenY, sourcePanelId, sourceTabIndex } = payload
      const windowId = randomUUID()

      const savedSize = getSettingJson<{ width: number; height: number }>('tearoff.lastSize')
      const width = savedSize?.width ?? 800
      const height = savedSize?.height ?? 600

      // Center the new window under the cursor
      const x = Math.round(screenX - width / 2)
      const y = Math.round(screenY - height / 2)

      const win = new BrowserWindow({
        width,
        height,
        x,
        y,
        show: false,
        backgroundColor: '#0A0A0A',
        titleBarStyle: 'hiddenInset',
        autoHideMenuBar: true,
        webPreferences: SHARED_WEB_PREFERENCES
      })

      win.on('ready-to-show', () => {
        win.show()
      })

      win.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
      })

      win.on('resize', () => {
        persistBoundsDebounced(windowId, win)
      })

      win.on('close', (event) => {
        if (isQuitting) {
          // App is quitting — let it proceed immediately
          tearoffWindows.delete(windowId)
          clearResizeTimer(windowId)
          return
        }

        // Prevent default and run the async two-phase close flow
        event.preventDefault()

        handleCloseRequest(windowId, win).catch((err) => {
          logger.error(`[tearoff] close flow error for ${windowId}: ${err}`)
          // Force-close as fallback
          tearoffWindows.delete(windowId)
          clearResizeTimer(windowId)
          try {
            win.destroy()
          } catch {
            /* already destroyed */
          }
        })
      })

      tearoffWindows.set(windowId, { win, view, windowId })

      loadTearoffUrl(win, view, windowId)

      // Notify main window that a tab was removed from the panel
      const mainWin = getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('tearoff:tabRemoved', {
          windowId,
          sourcePanelId,
          sourceTabIndex
        })
      }

      logger.info(`[tearoff] created window ${windowId} for view "${view}"`)

      return { windowId }
    }
  )

  // tearoff:closeConfirmed — tear-off window sends its close-dialog action back to the
  // main process. Routes to the per-window dynamic response channel that handleCloseRequest
  // is listening on via ipcMain.once.
  ipcMain.handle(
    'tearoff:closeConfirmed',
    (event, payload: { action: 'return' | 'close'; remember: boolean }) => {
      // Identify which tear-off window sent this response
      const senderWin = BrowserWindow.fromWebContents(event.sender)
      const entry = senderWin
        ? Array.from(tearoffWindows.values()).find((e) => e.win.id === senderWin.id)
        : undefined

      if (!entry) {
        logger.warn('[tearoff] closeConfirmed: could not identify sender window')
        return
      }

      if (payload?.remember) {
        setSettingJson('tearoff.closeAction', payload.action)
      }

      // Emit on the per-window dynamic channel that askRendererForAction is waiting on
      ipcMain.emit(`tearoff:closeResponse:${entry.windowId}`, event, {
        action: payload?.action ?? 'close'
      })
    }
  )

  // tearoff:returnToMain — tear-off window requests to be returned to the main window
  ipcMain.on('tearoff:returnToMain', (_event, payload: { windowId: string }) => {
    const { windowId } = payload ?? {}
    const entry = tearoffWindows.get(windowId)
    if (!entry) {
      logger.warn(`[tearoff] returnToMain: unknown windowId ${windowId}`)
      return
    }

    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('tearoff:tabReturned', { windowId, view: entry.view })
    }

    tearoffWindows.delete(windowId)
    clearResizeTimer(windowId)

    try {
      entry.win.destroy()
    } catch {
      /* already destroyed */
    }

    logger.info(`[tearoff] returned window ${windowId} to main`)
  })
}
