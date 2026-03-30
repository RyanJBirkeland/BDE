/**
 * tearoff-manager.ts — Main process module for tear-off window lifecycle.
 *
 * Manages creation, close flow (two-phase async with confirmation), bounds
 * persistence, and cleanup of tear-off BrowserWindows.
 */

import { BrowserWindow, ipcMain, shell, screen } from 'electron'
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
  views: string[]
  windowId: string
}

interface PersistedTearoff {
  windowId: string
  views: string[]
  bounds: { x: number; y: number; width: number; height: number }
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
  if (activeDrag) {
    clearInterval(activeDrag.pollInterval)
    clearTimeout(activeDrag.timeout)
    activeDrag = null
  }
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

function persistBoundsDebounced(windowId: string, _win: BrowserWindow): void {
  const existing = resizeTimers.get(windowId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    resizeTimers.delete(windowId)
    persistTearoffState()
  }, 500)

  resizeTimers.set(windowId, timer)
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

async function handleCloseRequest(windowId: string, win: BrowserWindow): Promise<void> {
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
  clearResizeTimer(windowId)
  persistTearoffState()

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
// Restore persisted tear-off windows on startup
// ---------------------------------------------------------------------------

/** Recreates tear-off windows from persisted state (call after app is ready). */
export function restoreTearoffWindows(): void {
  const saved = getSettingJson('tearoff.windows') as PersistedTearoff[] | null
  if (!saved || !Array.isArray(saved) || saved.length === 0) return

  for (const entry of saved) {
    if (!entry.views || entry.views.length === 0) continue

    const bounds =
      entry.bounds && isOnScreen(entry.bounds) ? entry.bounds : getDefaultBounds()
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

    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    win.on('resize', () => persistBoundsDebounced(windowId, win))
    win.on('move', () => persistBoundsDebounced(windowId, win))

    win.on('close', (event) => {
      if (isQuitting) {
        tearoffWindows.delete(windowId)
        clearResizeTimer(windowId)
        return
      }
      event.preventDefault()
      handleCloseRequest(windowId, win).catch((err) => {
        logger.error(`[tearoff] close flow error for ${windowId}: ${err}`)
        tearoffWindows.delete(windowId)
        clearResizeTimer(windowId)
        try {
          win.destroy()
        } catch {
          /* already destroyed */
        }
      })
    })

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

// ---------------------------------------------------------------------------
// Cross-window drag coordinator
// ---------------------------------------------------------------------------

interface ActiveDrag {
  sourceWindowId: string
  sourceWin: BrowserWindow
  viewKey: string
  pollInterval: ReturnType<typeof setInterval>
  targetWinId: number | null
  lastSentX: number
  lastSentY: number
  timeout: ReturnType<typeof setTimeout>
}

let activeDrag: ActiveDrag | null = null

function findWindowAtPoint(x: number, y: number, excludeId?: number): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (excludeId !== undefined && win.id === excludeId) continue
    const b = win.getContentBounds()
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
      return win
    }
  }
  return null
}

function startCursorPolling(): void {
  if (!activeDrag) return

  activeDrag.pollInterval = setInterval(() => {
    if (!activeDrag) return

    const cursor = screen.getCursorScreenPoint()
    const targetWin = findWindowAtPoint(cursor.x, cursor.y, activeDrag.sourceWin.id)

    if (targetWin) {
      const bounds = targetWin.getContentBounds()
      const localX = cursor.x - bounds.x
      const localY = cursor.y - bounds.y

      if (activeDrag.targetWinId !== targetWin.id) {
        // Entered a new window — cancel old target if any
        if (activeDrag.targetWinId !== null) {
          const oldWin = BrowserWindow.getAllWindows().find((w) => w.id === activeDrag!.targetWinId)
          oldWin?.webContents.send('tearoff:dragCancel')
        }
        activeDrag.targetWinId = targetWin.id
        activeDrag.lastSentX = localX
        activeDrag.lastSentY = localY
        targetWin.webContents.send('tearoff:dragIn', {
          viewKey: activeDrag.viewKey,
          x: localX,
          y: localY
        })
      } else if (localX !== activeDrag.lastSentX || localY !== activeDrag.lastSentY) {
        activeDrag.lastSentX = localX
        activeDrag.lastSentY = localY
        targetWin.webContents.send('tearoff:dragMove', { x: localX, y: localY })
      }
    } else {
      // Cursor is not over any tracked window
      if (activeDrag.targetWinId !== null) {
        const oldWin = BrowserWindow.getAllWindows().find((w) => w.id === activeDrag!.targetWinId)
        oldWin?.webContents.send('tearoff:dragCancel')
        activeDrag.targetWinId = null
      }
    }
  }, 32)
}

export function handleStartCrossWindowDrag(
  windowId: string,
  viewKey: string
): { targetFound: boolean } {
  // Clean up any existing drag
  cancelActiveDrag()

  // Find source window
  const entry = tearoffWindows.get(windowId)
  const sourceWin = entry ? entry.win : getMainWindow()
  if (!sourceWin) {
    logger.warn(`[tearoff] startCrossWindowDrag: cannot find source window for ${windowId}`)
    return { targetFound: false }
  }

  // Check if cursor is currently over another window
  const cursor = screen.getCursorScreenPoint()
  const targetWin = findWindowAtPoint(cursor.x, cursor.y, sourceWin.id)

  const timeout = setTimeout(() => {
    logger.info('[tearoff] cross-window drag timed out after 10s')
    cancelActiveDrag()
  }, 10_000)

  activeDrag = {
    sourceWindowId: windowId,
    sourceWin,
    viewKey,
    pollInterval: undefined as unknown as ReturnType<typeof setInterval>,
    targetWinId: null,
    lastSentX: -1,
    lastSentY: -1,
    timeout
  }

  // Listen for source window close to auto-cancel
  sourceWin.once('closed', () => {
    if (activeDrag && activeDrag.sourceWin === sourceWin) {
      cancelActiveDrag()
    }
  })

  startCursorPolling()

  if (targetWin) {
    const bounds = targetWin.getContentBounds()
    const localX = cursor.x - bounds.x
    const localY = cursor.y - bounds.y
    activeDrag.targetWinId = targetWin.id
    activeDrag.lastSentX = localX
    activeDrag.lastSentY = localY
    targetWin.webContents.send('tearoff:dragIn', { viewKey, x: localX, y: localY })
    return { targetFound: true }
  }

  return { targetFound: false }
}

function handleDropComplete(payload: {
  view: string
  targetPanelId: string
  zone: string
}): void {
  if (!activeDrag) return

  const { sourceWin } = activeDrag
  const targetWinId = activeDrag.targetWinId

  clearInterval(activeDrag.pollInterval)
  clearTimeout(activeDrag.timeout)
  activeDrag = null

  if (!sourceWin.isDestroyed()) {
    sourceWin.webContents.send('tearoff:dragDone')
  }

  if (targetWinId !== null) {
    const targetWin = BrowserWindow.getAllWindows().find((w) => w.id === targetWinId)
    targetWin?.webContents.send('tearoff:crossWindowDrop', {
      view: payload.view,
      targetPanelId: payload.targetPanelId,
      zone: payload.zone
    })
  }
}

export function cancelActiveDrag(): void {
  if (!activeDrag) return

  clearInterval(activeDrag.pollInterval)
  clearTimeout(activeDrag.timeout)

  // Notify all windows of cancellation
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('tearoff:dragCancel')
    }
  }

  activeDrag = null
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

      win.on('move', () => {
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

      tearoffWindows.set(windowId, { win, view, views: [view], windowId })

      loadTearoffUrl(win, view, windowId)

      persistTearoffState()

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

  // tearoff:startCrossWindowDrag — renderer initiates a cross-window drag
  ipcMain.handle('tearoff:startCrossWindowDrag', (_event, payload: { windowId: string; viewKey: string }) => {
    return handleStartCrossWindowDrag(payload.windowId, payload.viewKey)
  })

  // tearoff:dropComplete — target window signals a drop was accepted
  ipcMain.on(
    'tearoff:dropComplete',
    (_event, payload: { view: string; targetPanelId: string; zone: string }) => {
      handleDropComplete(payload)
    }
  )

  // tearoff:dragCancelFromRenderer — renderer requests drag cancellation
  ipcMain.on('tearoff:dragCancelFromRenderer', () => {
    cancelActiveDrag()
  })

  // tearoff:viewsChanged — tear-off window reports its current set of views
  ipcMain.on('tearoff:viewsChanged', (_event, payload: { windowId: string; views: string[] }) => {
    const entry = tearoffWindows.get(payload.windowId)
    if (entry) {
      entry.views = payload.views
      persistTearoffState()
    }
  })

  // tearoff:returnAll — bulk return all tabs from a tear-off window to the main window
  ipcMain.on('tearoff:returnAll', (_event, payload: { windowId: string; views: string[] }) => {
    const { windowId, views } = payload ?? {}
    const entry = tearoffWindows.get(windowId)
    if (!entry) {
      logger.warn(`[tearoff] returnAll: unknown windowId ${windowId}`)
      return
    }
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      for (const view of views) {
        mainWin.webContents.send('tearoff:tabReturned', { windowId, view })
      }
    }
    tearoffWindows.delete(windowId)
    clearResizeTimer(windowId)
    persistTearoffState()
    try { entry.win.destroy() } catch { /* already destroyed */ }
    logger.info(`[tearoff] returnAll: returned ${views.length} views from ${windowId}`)
  })

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
    persistTearoffState()

    try {
      entry.win.destroy()
    } catch {
      /* already destroyed */
    }

    logger.info(`[tearoff] returned window ${windowId} to main`)
  })
}
