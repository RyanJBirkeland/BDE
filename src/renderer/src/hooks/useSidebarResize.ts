/**
 * useSidebarResize — drag-to-resize hook for the sessions sidebar.
 * Returns current width and an onMouseDown handler for the resize handle.
 */
import { useState, useCallback } from 'react'
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX } from '../lib/constants'

interface SidebarResizeResult {
  sidebarWidth: number
  onResizeHandleMouseDown: (e: React.MouseEvent) => void
}

export function useSidebarResize(): SidebarResizeResult {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT)

  const onResizeHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = sidebarWidth
      const onMove = (ev: MouseEvent): void => {
        const delta = ev.clientX - startX
        setSidebarWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, startW + delta)))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sidebarWidth]
  )

  return { sidebarWidth, onResizeHandleMouseDown }
}
