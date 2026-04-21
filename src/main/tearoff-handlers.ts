/**
 * tearoff-handlers.ts — IPC registration orchestrator for tear-off windows.
 *
 * Wires all three focused modules together:
 * - tearoff-window-manager (window lifecycle)
 * - tearoff-state-persistence (bounds debounce)
 * - cross-window-drag-coordinator (cursor polling, drag state machine)
 *
 * This module owns NO state — it orchestrates calls to the three modules above.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getSetting, getSettingJson, setSettingJson } from './settings'
import { createLogger } from './logger'
import { safeHandle, safeOn } from './ipc-utils'
import {
  SHARED_WEB_PREFERENCES,
  getEntry,
  getEntries,
  setEntry,
  deleteEntry,
  getMainWindow,
  loadTearoffUrl,
  setupTearoffWindow,
  persistTearoffStateNow,
  getTearoffState
} from './tearoff-window-manager'
import { scheduleBoundsUpdate, clearResizeTimer } from './tearoff-state-persistence'
import {
  handleStartCrossWindowDrag,
  handleDropComplete,
  cancelActiveDrag
} from './cross-window-drag-coordinator'

const logger = createLogger('tearoff-handlers')

const WINDOW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Shared persistence callback
// ---------------------------------------------------------------------------

/**
 * Called by tearoff-window-manager's resize/move events (via onPersistBounds).
 * Routes through tearoff-state-persistence debounce → then saves state.
 */
function onPersistBounds(windowId: string): void {
  scheduleBoundsUpdate(windowId, () => {
    persistTearoffStateNow()
  })
}

// Re-export for use in tearoff-manager shim
export { onPersistBounds, SHARED_WEB_PREFERENCES }

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerTearoffHandlers(): void {
  // tearoff:create — renderer requests a new tear-off window
  type TearoffCreatePayload = {
    view: string
    screenX: number
    screenY: number
    sourcePanelId: string
    sourceTabIndex: number
  }
  safeHandle('tearoff:create', (_event, payload: TearoffCreatePayload): { windowId: string } => {
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

    setupTearoffWindow(win, windowId, onPersistBounds)

    setEntry(windowId, { win, view, views: [view], windowId })

    loadTearoffUrl(win, view, windowId)

    persistTearoffStateNow()

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
  })

  // tearoff:closeConfirmed — tear-off window sends its close-dialog action back to the
  // main process. Routes to the per-window dynamic response channel that handleCloseRequest
  // is listening on via ipcMain.once.
  type CloseConfirmedPayload = { action: 'return' | 'close'; remember: boolean }
  safeHandle('tearoff:closeConfirmed', (event, payload: CloseConfirmedPayload) => {
    // Identify which tear-off window sent this response
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    const entry = senderWin
      ? Array.from(getEntries()).find((e) => e.win.id === senderWin.id)
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
  })

  // tearoff:startCrossWindowDrag — renderer initiates a cross-window drag
  type CrossWindowDragPayload = { windowId: string; viewKey: string }
  safeHandle('tearoff:startCrossWindowDrag', (_event, payload: CrossWindowDragPayload) => {
    return handleStartCrossWindowDrag(payload.windowId, payload.viewKey)
  })

  // tearoff:dropComplete — target window signals a drop was accepted
  safeOn('tearoff:dropComplete', (_event, payload) => {
    handleDropComplete(payload)
  })

  // tearoff:dragCancelFromRenderer — renderer requests drag cancellation
  safeOn('tearoff:dragCancelFromRenderer', () => {
    cancelActiveDrag()
  })

  // tearoff:viewsChanged — tear-off window reports its current set of views
  safeOn('tearoff:viewsChanged', (_event, payload) => {
    const { windowId, views } = payload
    if (!WINDOW_ID_PATTERN.test(windowId)) {
      logger.warn(`tearoff: invalid windowId format "${windowId}"`)
      return
    }
    const entry = getEntry(windowId)
    if (entry) {
      entry.views = views
      persistTearoffStateNow()
    }
  })

  // tearoff:returnAll — bulk return all tabs from a tear-off window to the main window
  safeOn('tearoff:returnAll', (_event, payload) => {
    const { windowId, views } = payload ?? {}
    if (!WINDOW_ID_PATTERN.test(windowId)) {
      logger.warn(`tearoff: invalid windowId format "${windowId}"`)
      return
    }
    const entry = getEntry(windowId)
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
    deleteEntry(windowId)
    clearResizeTimer(windowId)
    persistTearoffStateNow()
    try {
      entry.win.destroy()
    } catch {
      /* already destroyed */
    }
    logger.info(`[tearoff] returnAll: returned ${views.length} views from ${windowId}`)
  })

  // tearoff:returnToMain — tear-off window requests to be returned to the main window
  safeOn('tearoff:returnToMain', (_event, payload) => {
    const { windowId } = payload ?? {}
    if (!WINDOW_ID_PATTERN.test(windowId)) {
      logger.warn(`tearoff: invalid windowId format "${windowId}"`)
      return
    }
    const entry = getEntry(windowId)
    if (!entry) {
      logger.warn(`[tearoff] returnToMain: unknown windowId ${windowId}`)
      return
    }

    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('tearoff:tabReturned', { windowId, view: entry.view })
    }

    deleteEntry(windowId)
    clearResizeTimer(windowId)
    persistTearoffStateNow()

    try {
      entry.win.destroy()
    } catch {
      /* already destroyed */
    }

    logger.info(`[tearoff] returned window ${windowId} to main`)
  })
}

// Re-export additional utilities needed by the shim
export { getMainWindow, getTearoffState, getSetting, getSettingJson, setSettingJson }
