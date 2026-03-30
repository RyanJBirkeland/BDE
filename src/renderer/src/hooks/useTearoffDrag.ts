import { useCallback, useEffect, useRef } from 'react'

export interface DragPayload {
  sourcePanelId: string
  sourceTabIndex: number
  viewKey: string
}

export interface TearoffDragApi {
  startDrag: (payload: DragPayload) => void
  endDrag: () => void
}

/**
 * Detects when a tab drag exits the browser window boundary and triggers a tear-off.
 *
 * Usage:
 * - Call startDrag(payload) on dragstart of a tab
 * - Call endDrag() on dragend (also called automatically via the dragend listener)
 *
 * When the drag cursor leaves the window for 200ms (debounce):
 * 1. Attempts cross-window drag first (startCrossWindowDrag IPC) — if a target window
 *    is found, the drag enters cross-window mode and no new tear-off window is created.
 * 2. If no target window responds, falls back to Phase 1 behavior: window.api.tearoff.create.
 *
 * @param windowId - Optional window ID for this window (from URL query params in tear-offs).
 */
export function useTearoffDrag(windowId?: string): TearoffDragApi {
  const dragData = useRef<DragPayload | null>(null)
  const lastScreen = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const tearoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tearoffCreated = useRef<boolean>(false)
  const crossWindowActive = useRef<boolean>(false)
  const currentWindowId = useRef(windowId)
  currentWindowId.current = windowId

  const endDrag = useCallback((): void => {
    if (tearoffTimer.current !== null) {
      clearTimeout(tearoffTimer.current)
      tearoffTimer.current = null
    }
    dragData.current = null
    tearoffCreated.current = false
    crossWindowActive.current = false
  }, [])

  function startDrag(payload: DragPayload): void {
    endDrag()
    dragData.current = payload
    tearoffCreated.current = false
  }

  useEffect(() => {
    function onDragOver(e: DragEvent): void {
      // Chromium sometimes sends 0,0 — skip to avoid resetting to invalid coords
      if (e.screenX === 0 && e.screenY === 0) return
      lastScreen.current = { x: e.screenX, y: e.screenY }
    }

    function onDragLeave(e: DragEvent): void {
      // Only react when the cursor leaves the root document element
      if (e.target !== document.documentElement) return
      if (dragData.current === null) return

      // Start 200ms debounce timer (skip if one is already pending)
      if (tearoffTimer.current !== null) return
      tearoffTimer.current = setTimeout(async () => {
        tearoffTimer.current = null
        if (dragData.current === null || tearoffCreated.current) return

        // Try cross-window drag first
        if (window.api?.tearoff?.startCrossWindowDrag) {
          try {
            const result = await window.api.tearoff.startCrossWindowDrag({
              windowId: currentWindowId.current ?? '',
              viewKey: dragData.current.viewKey
            })
            if (result.targetFound) {
              tearoffCreated.current = true
              crossWindowActive.current = true
              return
            }
          } catch {
            // Fall through to Phase 1 behavior
          }
        }

        // No target window — create new tear-off (Phase 1 behavior)
        tearoffCreated.current = true
        const { viewKey, sourcePanelId, sourceTabIndex } = dragData.current
        window.api.tearoff.create({
          view: viewKey,
          screenX: lastScreen.current.x,
          screenY: lastScreen.current.y,
          sourcePanelId,
          sourceTabIndex
        })
      }, 200)
    }

    function onDragEnter(e: DragEvent): void {
      // Cursor re-entered window — cancel pending tear-off
      if (e.target !== document.documentElement) return
      if (tearoffTimer.current !== null) {
        clearTimeout(tearoffTimer.current)
        tearoffTimer.current = null
      }
    }

    function onDragEnd(): void {
      if (crossWindowActive.current) {
        crossWindowActive.current = false
        dragData.current = null
        return
      }
      endDrag()
    }

    document.addEventListener('dragover', onDragOver)
    document.documentElement.addEventListener('dragleave', onDragLeave)
    document.documentElement.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragend', onDragEnd)

    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.documentElement.removeEventListener('dragleave', onDragLeave)
      document.documentElement.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragend', onDragEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { startDrag, endDrag }
}
