import { useEffect, useRef } from 'react'

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
 * When the drag cursor leaves the window for 200ms (debounce), window.api.tearoff.create
 * is called with the drag payload and last known screen coordinates.
 */
export function useTearoffDrag(): TearoffDragApi {
  const dragData = useRef<DragPayload | null>(null)
  const lastScreen = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const tearoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tearoffCreated = useRef<boolean>(false)

  function endDrag(): void {
    if (tearoffTimer.current !== null) {
      clearTimeout(tearoffTimer.current)
      tearoffTimer.current = null
    }
    dragData.current = null
    tearoffCreated.current = false
  }

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
      tearoffTimer.current = setTimeout(() => {
        tearoffTimer.current = null
        if (dragData.current === null) return
        if (tearoffCreated.current) return

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
