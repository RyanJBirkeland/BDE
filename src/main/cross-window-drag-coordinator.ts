/**
 * cross-window-drag-coordinator.ts — Cursor polling and drag state machine.
 *
 * Owns: activeDrag state, cursor position polling at CURSOR_POLL_INTERVAL_MS,
 * window hit-testing, and the drag lifecycle (start → move → drop/cancel).
 */

import { BrowserWindow, screen } from 'electron'
import { createLogger } from './logger'
import { CURSOR_POLL_INTERVAL_MS, CROSS_WINDOW_DRAG_TIMEOUT_MS } from './constants'

// The window-manager module is imported only for its Map accessor — no circular dep
// because window-manager does NOT import from this module.
import { getEntry, getMainWindow } from './tearoff-window-manager'

const logger = createLogger('cross-window-drag-coordinator')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveDrag {
  sourceWindowId: string
  sourceWin: BrowserWindow
  viewKey: string
  pollInterval: ReturnType<typeof setInterval> | null
  targetWinId: number | null
  lastSentX: number
  lastSentY: number
  timeout: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let activeDrag: ActiveDrag | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** FOR TESTING ONLY — resets drag state between test runs. */
export function _resetForTest(): void {
  if (activeDrag) {
    if (activeDrag.pollInterval !== null) clearInterval(activeDrag.pollInterval)
    clearTimeout(activeDrag.timeout)
  }
  activeDrag = null
}

/** Returns the current active drag state (for testing/inspection). */
export function getActiveDrag(): ActiveDrag | null {
  return activeDrag
}

export function handleStartCrossWindowDrag(
  windowId: string,
  viewKey: string
): { targetFound: boolean } {
  // Clean up any existing drag
  cancelActiveDrag()

  // Find source window
  const entry = getEntry(windowId)
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
  }, CROSS_WINDOW_DRAG_TIMEOUT_MS)

  activeDrag = {
    sourceWindowId: windowId,
    sourceWin,
    viewKey,
    pollInterval: null,
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

export function handleDropComplete(payload: {
  view: string
  targetPanelId: string
  zone: string
}): void {
  if (!activeDrag) return

  const { sourceWin } = activeDrag
  const targetWinId = activeDrag.targetWinId

  if (activeDrag.pollInterval !== null) clearInterval(activeDrag.pollInterval)
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

  if (activeDrag.pollInterval !== null) clearInterval(activeDrag.pollInterval)
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
// Internal helpers
// ---------------------------------------------------------------------------

function findWindowAtPoint(x: number, y: number, excludeId?: number): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (excludeId !== undefined && win.id === excludeId) continue
    const bounds = win.getContentBounds()
    if (
      x >= bounds.x &&
      x < bounds.x + bounds.width &&
      y >= bounds.y &&
      y < bounds.y + bounds.height
    ) {
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
  }, CURSOR_POLL_INTERVAL_MS)
}
