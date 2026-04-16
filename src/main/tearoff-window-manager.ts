/**
 * tearoff-window-manager.ts — BrowserWindow lifecycle for tear-off windows.
 *
 * Owns: window creation, setup, 2-phase close flow, and restoration from
 * persisted state. Receives an `onPersistBounds` callback for debounced
 * bounds saving — does NOT import from tearoff-state-persistence directly.
 */

import { BrowserWindow, ipcMain, shell, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { randomUUID } from 'crypto'
import { getSetting, getSettingJson, setSettingJson } from './settings'
import { createLogger } from './logger'

const logger = createLogger('tearoff-window-manager')

// ---------------------------------------------------------------------------
// Shared web preferences (matches main window)
// ---------------------------------------------------------------------------

export const SHARED_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TearoffEntry {
  win: BrowserWindow
  view: string
  views: string[]
  windowId: string
}

export interface PersistedTearoff {
  windowId: string
  views: string[]
  bounds: { x: number; y: number; width: number; height: number }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const tearoffWindows = new Map<string, TearoffEntry>()
let isQuitting = false

// ---------------------------------------------------------------------------
// Public entry map accessors
// ---------------------------------------------------------------------------

export function getEntry(windowId: string): TearoffEntry | undefined {
  return tearoffWindows.get(windowId)
}

export function getEntries(): TearoffEntry[] {
  return Array.from(tearoffWindows.values())
}

export function setEntry(windowId: string, entry: TearoffEntry): void {
  tearoffWindows.set(windowId, entry)
}

export function deleteEntry(windowId: string): void {
  tearoffWindows.delete(windowId)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Sets the quitting flag so close handlers skip confirmation dialogs. */
export function setQuitting(): void {
  isQuitting = true
}

/** FOR TESTING ONLY — resets window-manager module state between test runs. */
export function _resetForTest(): void {
  tearoffWindows.clear()
  isQuitting = false
}

/** Destroys all tear-off windows (call on app quit). */
export function closeTearoffWindows(): void {
  persistTearoffState()
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
  const tearoffIds = new Set(Array.from(tearoffWindows.values()).map((e) => e.win.id))
  const all = BrowserWindow.getAllWindows()
  return all.find((w) => !tearoffIds.has(w.id)) ?? null
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function persistTearoffState(): void {
  const state = Array.from(tearoffWindows.values())
    .filter((e) => !e.win.isDestroyed())
    .map((e) => ({
      windowId: e.windowId,
      views: e.views.length > 0 ? e.views : [e.view],
      bounds: e.win.getBounds()
    }))
  setSettingJson('tearoff.windows', state)
}

export function getTearoffState(): PersistedTearoff[] {
  return Array.from(tearoffWindows.values())
    .filter((e) => !e.win.isDestroyed())
    .map((e) => ({
      windowId: e.windowId,
      views: e.views.length > 0 ? e.views : [e.view],
      bounds: e.win.getBounds()
    }))
}

export function persistTearoffStateNow(): void {
  persistTearoffState()
}

// ---------------------------------------------------------------------------
// Window creation helpers
// ---------------------------------------------------------------------------

export function loadTearoffUrl(win: BrowserWindow, view: string, windowId: string): void {
  const query = `?view=${encodeURIComponent(view)}&windowId=${encodeURIComponent(windowId)}`

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }
}

function isOnScreen(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const db = d.bounds
    return (
      bounds.x < db.x + db.width &&
      bounds.x + bounds.width > db.x &&
      bounds.y < db.y + db.height &&
      bounds.y + bounds.height > db.y
    )
  })
}

function getDefaultBounds(): { x: number; y: number; width: number; height: number } {
  const primary = screen.getPrimaryDisplay()
  return {
    x: Math.round(primary.bounds.x + primary.bounds.width / 2 - 400),
    y: Math.round(primary.bounds.y + primary.bounds.height / 2 - 300),
    width: 800,
    height: 600
  }
}

/** Shared setup for tear-off windows: external link handler, bounds persistence, close flow. */
export function setupTearoffWindow(
  win: BrowserWindow,
  windowId: string,
  onPersistBounds: (windowId: string) => void
): void {
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  win.on('resize', () => onPersistBounds(windowId))
  win.on('move', () => onPersistBounds(windowId))

  win.on('close', (event) => {
    if (isQuitting) {
      tearoffWindows.delete(windowId)
      return
    }
    event.preventDefault()
    handleCloseRequest(windowId, win).catch((err) => {
      logger.error(`[tearoff] close flow error for ${windowId}: ${err}`)
      tearoffWindows.delete(windowId)
      try {
        win.destroy()
      } catch {
        /* already destroyed */
      }
    })
  })
}

export async function handleCloseRequest(windowId: string, win: BrowserWindow): Promise<void> {
  // Check persisted preference
  const closeAction = getSetting('tearoff.closeAction') as 'return' | 'close' | null

  const action = closeAction ?? (await askRendererForAction(windowId, win))

  if (action === 'return') {
    const mainWin = getMainWindow()
    const entry = tearoffWindows.get(windowId)
    if (mainWin && !mainWin.isDestroyed() && entry) {
      mainWin.webContents.send('tearoff:tabReturned', { windowId, view: entry.view })
    }
  }

  // Remove from map and destroy
  tearoffWindows.delete(windowId)
  persistTearoffState()

  try {
    win.destroy()
  } catch {
    /* already destroyed */
  }
}

function askRendererForAction(windowId: string, win: BrowserWindow): Promise<'return' | 'close'> {
  return new Promise<'return' | 'close'>((resolve) => {
    // Dynamic per-window channel: tearoff:closeResponse:<windowId>.
    // This cannot be a static safeHandle() registration because the channel name
    // encodes the windowId — each window needs its own one-shot listener that
    // resolves the Promise returned to handleCloseRequest. The outer handler
    // (tearoff:closeConfirmed in tearoff-handlers.ts) is already wrapped in
    // safeHandle(); this ipcMain.once is an internal relay, not a renderer-facing
    // entry point.
    const responseChannel = `tearoff:closeResponse:${windowId}`

    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(responseChannel)
      logger.warn(`[tearoff] close-dialog timed out for ${windowId} — defaulting to 'close'`)
      resolve('close')
    }, 5000)

    ipcMain.once(responseChannel, (_event, payload: { action: 'return' | 'close' }) => {
      clearTimeout(timeout)
      if (!payload?.action) {
        logger.warn(`[tearoff] close-dialog response for ${windowId} had no action — defaulting to 'close'`)
      }
      resolve(payload?.action ?? 'close')
    })

    win.webContents.send('tearoff:confirmClose', { windowId })
  })
}

// ---------------------------------------------------------------------------
// Restore persisted tear-off windows on startup
// ---------------------------------------------------------------------------

/** Recreates tear-off windows from persisted state (call after app is ready). */
export function restoreTearoffWindows(onPersistBounds: (windowId: string) => void): void {
  const saved = getSettingJson('tearoff.windows') as PersistedTearoff[] | null
  if (!saved || !Array.isArray(saved) || saved.length === 0) return

  for (const entry of saved) {
    if (!entry.views || entry.views.length === 0) continue

    const bounds = entry.bounds && isOnScreen(entry.bounds) ? entry.bounds : getDefaultBounds()
    const windowId = randomUUID()

    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      backgroundColor: '#0A0A0A',
      titleBarStyle: 'hiddenInset',
      autoHideMenuBar: true,
      webPreferences: SHARED_WEB_PREFERENCES
    })

    setupTearoffWindow(win, windowId, onPersistBounds)

    tearoffWindows.set(windowId, {
      win,
      view: entry.views[0],
      views: [...entry.views],
      windowId
    })

    // Load with restore param so renderer knows to restore multi-tab state
    const restoreParam = encodeURIComponent(JSON.stringify(entry.views))
    const query = `?view=${encodeURIComponent(entry.views[0])}&windowId=${encodeURIComponent(windowId)}&restore=${restoreParam}`

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
    }

    win.once('ready-to-show', () => win.show())
    logger.info(`[tearoff] restored window ${windowId} with views: ${entry.views.join(', ')}`)
  }
}
