import React, { useState } from 'react'
import type { DropZone } from '../../stores/panelLayout'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DragPayload {
  viewKey: string
  sourcePanelId?: string
  sourceTabIndex?: number
}

interface PanelDropOverlayProps {
  panelId: string
  onDrop: (panelId: string, zone: DropZone, data: DragPayload) => void
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Hit-testing — exported for unit tests
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components
export function getDropZone(x: number, y: number, rect: Rect): DropZone {
  const pctX = (x - rect.left) / rect.width
  const pctY = (y - rect.top) / rect.height

  if (pctY < 0.25) return 'top'
  if (pctY > 0.75) return 'bottom'
  if (pctX < 0.25) return 'left'
  if (pctX > 0.75) return 'right'
  return 'center'
}

// ---------------------------------------------------------------------------
// Zone highlight styles
// ---------------------------------------------------------------------------

const HIGHLIGHT_COLOR = 'var(--bde-info-dim)'

function zoneStyle(zone: DropZone): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    background: HIGHLIGHT_COLOR,
    pointerEvents: 'none'
  }

  switch (zone) {
    case 'top':
      return { ...base, top: 0, left: 0, right: 0, height: '50%' }
    case 'bottom':
      return { ...base, bottom: 0, left: 0, right: 0, height: '50%' }
    case 'left':
      return { ...base, top: 0, left: 0, bottom: 0, width: '50%' }
    case 'right':
      return { ...base, top: 0, right: 0, bottom: 0, width: '50%' }
    case 'center':
      return { ...base, top: '10%', left: '10%', right: '10%', bottom: '10%' }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PanelDropOverlay({ panelId, onDrop }: PanelDropOverlayProps): React.ReactElement {
  const [activeZone, setActiveZone] = useState<DropZone | null>(null)

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const zone = getDropZone(e.clientX, e.clientY, rect)
    setActiveZone(zone)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/bde-panel')
    if (!raw) return

    const rect = e.currentTarget.getBoundingClientRect()
    const zone = getDropZone(e.clientX, e.clientY, rect)

    let data: DragPayload
    try {
      data = JSON.parse(raw) as DragPayload
    } catch {
      return
    }

    setActiveZone(null)
    onDrop(panelId, zone, data)
  }

  function handleDragLeave(): void {
    setActiveZone(null)
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'all',
        zIndex: 10
      }}
    >
      {activeZone !== null && <div style={zoneStyle(activeZone)} />}
    </div>
  )
}
