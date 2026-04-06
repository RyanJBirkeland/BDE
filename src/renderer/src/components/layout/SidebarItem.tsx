import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { NeonTooltip } from '../neon/NeonTooltip'
import type { View } from '../../stores/panelLayout'

interface SidebarItemProps {
  view: View
  icon: ReactNode
  label: string
  shortcut: string
  isActive: boolean
  isOpen: boolean
  badge?: number
  badgeAccent?: 'red' | 'blue' | 'orange'
  onActivate: (view: View) => void
  onContextAction: (action: string, view: View) => void
}

interface ContextMenuState {
  x: number
  y: number
}

const MENU_ITEMS = [
  { label: 'Unpin from sidebar', action: 'unpin' },
  { label: 'Open to Right', action: 'open-right' },
  { label: 'Open Below', action: 'open-below' },
  { label: 'Open in New Tab', action: 'open-tab' },
  { label: 'Open in New Window', action: 'open-window' },
  { label: 'Close All', action: 'close-all' }
]

export function SidebarItem({
  view,
  icon,
  label,
  shortcut,
  isActive,
  isOpen,
  badge,
  badgeAccent = 'orange',
  onActivate,
  onContextAction
}: SidebarItemProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerId = `sidebar-trigger-${view}`

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // Shift+F10 or ContextMenu key opens context menu
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault()
      e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      setContextMenu({ x: rect.right, y: rect.top })
    }
  }

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleMenuAction = useCallback(
    (action: string) => {
      onContextAction(action, view)
      setContextMenu(null)
    },
    [onContextAction, view]
  )

  // Auto-focus first menu item when menu opens
  useEffect(() => {
    if (contextMenu && menuRef.current) {
      const first = menuRef.current.querySelector<HTMLElement>('[role="menuitem"]')
      first?.focus()
    }
  }, [contextMenu])

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const menu = menuRef.current
      if (!menu) return
      const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      const currentIndex = items.indexOf(e.target as HTMLElement)

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
          items[next]?.focus()
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
          items[prev]?.focus()
          break
        }
        case 'Home':
          e.preventDefault()
          items[0]?.focus()
          break
        case 'End':
          e.preventDefault()
          items[items.length - 1]?.focus()
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          if (currentIndex >= 0) handleMenuAction(MENU_ITEMS[currentIndex].action)
          break
        case 'Escape':
          e.preventDefault()
          closeContextMenu()
          break
      }
    },
    [handleMenuAction, closeContextMenu]
  )

  const handleMenuBlur = useCallback((e: React.FocusEvent) => {
    // Close if focus leaves the menu entirely
    if (menuRef.current && !menuRef.current.contains(e.relatedTarget as Node)) {
      setContextMenu(null)
    }
  }, [])

  return (
    <>
      <NeonTooltip label={label} shortcut={shortcut}>
        <button
          id={triggerId}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('application/bde-panel', JSON.stringify({ viewKey: view }))
            e.dataTransfer.setData('text/plain', label)
          }}
          className={`sidebar-item${isActive ? ' sidebar-item--active' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onActivate(view)
          }}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          aria-label={
            badge != null && badge > 0 ? `${label} — ${badge} items needing attention` : label
          }
          aria-haspopup="menu"
          aria-expanded={contextMenu !== null}
          aria-current={isActive ? 'page' : undefined}
        >
          {icon}
          {isOpen && !isActive && <span className="sidebar-item__open-dot" />}
          {badge != null && badge > 0 && (
            <span
              className={`sidebar-item__badge sidebar-item__badge--${badgeAccent}`}
              data-testid={`sidebar-badge-${view}`}
              data-accent={badgeAccent}
              aria-hidden="true"
            >
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </button>
      </NeonTooltip>

      {contextMenu && (
        <>
          {/* Invisible overlay to catch outside clicks */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999
            }}
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeContextMenu()
            }}
          />
          <div
            ref={menuRef}
            className="sidebar-context-menu"
            role="menu"
            aria-labelledby={triggerId}
            onKeyDown={handleMenuKeyDown}
            onBlur={handleMenuBlur}
            style={{
              top: contextMenu.y,
              left: contextMenu.x
            }}
          >
            {MENU_ITEMS.map(({ label: menuLabel, action }) => (
              <button
                key={action}
                className="sidebar-context-menu__item"
                role="menuitem"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  handleMenuAction(action)
                }}
              >
                {menuLabel}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
