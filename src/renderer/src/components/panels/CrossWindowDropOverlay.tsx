import React, { useEffect, useState } from 'react'
import type { DropZone } from '../../stores/panelLayout'
import { getDropZone } from './PanelDropOverlay'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossWindowDropOverlayProps {
  active: boolean
  localX: number
  localY: number
  viewKey: string
  onDrop: (targetPanelId: string, zone: string) => void
}

interface HitInfo {
  panelId: string
  zone: DropZone
  rect: DOMRect
}

// ---------------------------------------------------------------------------
// Zone highlight styles (mirrors PanelDropOverlay)
// ---------------------------------------------------------------------------

const HIGHLIGHT_COLOR = 'rgba(59, 130, 246, 0.15)'

function zoneStyle(zone: DropZone, rect: DOMRect): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'fixed',
    background: HIGHLIGHT_COLOR,
    pointerEvents: 'none',
    zIndex: 10000
  }

  switch (zone) {
    case 'top':
      return { ...base, top: rect.top, left: rect.left, width: rect.width, height: rect.height * 0.5 }
    case 'bottom':
      return { ...base, top: rect.top + rect.height * 0.5, left: rect.left, width: rect.width, height: rect.height * 0.5 }
    case 'left':
      return { ...base, top: rect.top, left: rect.left, width: rect.width * 0.5, height: rect.height }
    case 'right':
      return { ...base, top: rect.top, left: rect.left + rect.width * 0.5, width: rect.width * 0.5, height: rect.height }
    case 'center':
      return {
        ...base,
        top: rect.top + rect.height * 0.1,
        left: rect.left + rect.width * 0.1,
        width: rect.width * 0.8,
        height: rect.height * 0.8
      }
  }
}

// ---------------------------------------------------------------------------
// Hit-test: find which panel (if any) contains the given client coordinates
// ---------------------------------------------------------------------------

function findPanelUnderCursor(x: number, y: number): HitInfo | null {
  const panels = document.querySelectorAll<HTMLElement>('[data-panel-id]')
  for (const el of panels) {
    const rect = el.getBoundingClientRect()
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const panelId = el.getAttribute('data-panel-id')
      if (!panelId) continue
      const zone = getDropZone(x, y, rect)
      return { panelId, zone, rect }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CrossWindowDropOverlay({
  active,
  localX,
  localY,
  viewKey: _viewKey,
  onDrop
}: CrossWindowDropOverlayProps): React.ReactElement | null {
  const [hitInfo, setHitInfo] = useState<HitInfo | null>(null)

  // Recompute hit info whenever cursor position changes
  useEffect(() => {
    if (!active) {
      setHitInfo(null)
      return
    }
    setHitInfo(findPanelUnderCursor(localX, localY))
  }, [active, localX, localY])

  if (!active) return null

  function handlePointerUp(): void {
    if (hitInfo) {
      onDrop(hitInfo.panelId, hitInfo.zone)
    }
  }

  return (
    <>
      <div
        data-testid="cross-window-drop-overlay"
        onPointerUp={handlePointerUp}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          pointerEvents: 'all',
          cursor: 'crosshair'
        }}
      />
      {hitInfo && <div data-testid="drop-zone-highlight" style={zoneStyle(hitInfo.zone, hitInfo.rect)} />}
    </>
  )
}

export default CrossWindowDropOverlay
