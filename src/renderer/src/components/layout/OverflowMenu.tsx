import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pin, Settings } from 'lucide-react'
import { GlassPanel } from '../neon/GlassPanel'
import type { View } from '../../stores/panelLayout'
import { VIEW_ICONS, VIEW_LABELS } from '../../lib/view-registry'

interface OverflowMenuProps {
  unpinnedViews: View[]
  anchorRect: DOMRect | null
  onPin: (view: View) => void
  onActivate: (view: View) => void
  onClose: () => void
}

export function OverflowMenu({
  unpinnedViews,
  anchorRect,
  onPin,
  onActivate,
  onClose
}: OverflowMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Add small delay to avoid immediate close from the trigger click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Handle Escape key and arrow navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      const itemCount = unpinnedViews.length
      if (itemCount === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev + 1) % itemCount)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev === 0 ? itemCount - 1 : prev - 1))
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, unpinnedViews.length])

  // Move focus when focusedIndex changes (including initial mount)
  useEffect(() => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    items?.[focusedIndex]?.focus()
  }, [focusedIndex])

  if (!anchorRect) return null

  // Position above the trigger button
  const style: React.CSSProperties = {
    top: anchorRect.top - 8, // 8px gap above
    left: anchorRect.left + anchorRect.width / 2,
    transform: 'translate(-50%, -100%)'
  }

  const handleItemClick = (view: View): void => {
    onActivate(view)
    onClose()
  }

  const handlePinClick = (e: React.MouseEvent, view: View): void => {
    e.stopPropagation()
    onPin(view)
  }

  const handleCustomizeClick = (): void => {
    onActivate('settings')
    onClose()
  }

  return createPortal(
    <div ref={menuRef} className="overflow-menu" style={style}>
      <GlassPanel accent="purple" style={{ padding: '8px' }}>
        {unpinnedViews.length === 0 ? (
          <div className="overflow-menu__empty">All views are pinned</div>
        ) : (
          <div role="menu">
            {unpinnedViews.map((view, index) => {
              const Icon = VIEW_ICONS[view]
              const label = VIEW_LABELS[view]

              return (
                <div
                  key={view}
                  className="overflow-menu__item"
                  onClick={() => handleItemClick(view)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleItemClick(view)
                    }
                  }}
                  role="menuitem"
                  tabIndex={index === focusedIndex ? 0 : -1}
                >
                  <Icon size={14} strokeWidth={1.5} />
                  <span>{label}</span>
                  <button
                    className="overflow-menu__item-pin"
                    onClick={(e) => handlePinClick(e, view)}
                    aria-label={`Pin ${label} to sidebar`}
                    title="Pin to sidebar"
                    type="button"
                  >
                    <Pin size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="overflow-menu__separator">
          <button className="overflow-menu__customize-btn" onClick={handleCustomizeClick}>
            <Settings size={14} strokeWidth={1.5} />
            <span>Customize sidebar...</span>
          </button>
        </div>
      </GlassPanel>
    </div>,
    document.body
  )
}
