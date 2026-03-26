import React from 'react'
import { X } from 'lucide-react'

// ---------------------------------------------------------------------------
// HeaderTab — Single tab in the unified header
// ---------------------------------------------------------------------------

interface HeaderTabProps {
  label: string
  isActive: boolean
  showDot?: boolean
  showClose?: boolean
  onClick: () => void
  onClose: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
}

export function HeaderTab({
  label,
  isActive,
  showDot = false,
  showClose = true,
  onClick,
  onClose,
  draggable = false,
  onDragStart
}: HeaderTabProps): React.JSX.Element {
  function handleClose(e: React.MouseEvent): void {
    e.stopPropagation()
    onClose()
  }

  const className = isActive ? 'header-tab header-tab--active' : 'header-tab'

  return (
    <div
      className={className}
      onClick={onClick}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      draggable={draggable}
      onDragStart={onDragStart}
      role="tab"
      aria-selected={isActive}
      title={label}
    >
      {showDot && <div className="header-tab__dot" />}
      <span>{label}</span>
      {showClose && (
        <button
          className="header-tab__close"
          onClick={handleClose}
          aria-label={`Close ${label}`}
          type="button"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}
