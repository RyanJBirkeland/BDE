import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Edit2, MoreVertical, CheckCircle2 } from 'lucide-react'
import type { TaskGroup } from '../../../../shared/types'
import { withAlpha } from '../../lib/utils'
import './EpicHeader.css'

export interface EpicHeaderProps {
  group: TaskGroup
  isReady: boolean
  isCompleted: boolean
  doneCount: number
  totalCount: number
  onOpenAssistant: () => void
  onEdit: () => Promise<void>
  onToggleReady: () => void
  onMarkCompleted: () => void
  onDelete: () => Promise<void>
  onTogglePause: () => void
}

export function EpicHeader({
  group,
  isReady,
  isCompleted,
  doneCount,
  totalCount,
  onOpenAssistant,
  onEdit,
  onToggleReady,
  onMarkCompleted,
  onDelete,
  onTogglePause
}: EpicHeaderProps): React.JSX.Element {
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<HTMLButtonElement[]>([])

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false)
      }
    }
    if (showOverflowMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      // Focus the first menu item when the menu opens
      requestAnimationFrame(() => {
        menuItemsRef.current[0]?.focus()
      })
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
    return undefined
  }, [showOverflowMenu])

  // Keyboard navigation for overflow menu
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = menuItemsRef.current.filter(Boolean)
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)

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
      case 'Escape':
        e.preventDefault()
        setShowOverflowMenu(false)
        break
      case 'Tab':
        setShowOverflowMenu(false)
        break
    }
  }, [])

  const handleEditClick = (): void => {
    setShowOverflowMenu(false)
    void onEdit()
  }

  const handleToggleReadyClick = (): void => {
    setShowOverflowMenu(false)
    onToggleReady()
  }

  const handleMarkCompletedClick = (): void => {
    setShowOverflowMenu(false)
    onMarkCompleted()
  }

  const handleDeleteClick = (): void => {
    setShowOverflowMenu(false)
    void onDelete()
  }

  const handleTogglePauseClick = (): void => {
    setShowOverflowMenu(false)
    onTogglePause()
  }

  return (
    <div className="epic-detail__header">
      <div
        className="epic-detail__icon"
        style={{
          background: withAlpha(group.accent_color, 12.5),
          color: group.accent_color,
          borderColor: withAlpha(group.accent_color, 25)
        }}
      >
        {group.icon.charAt(0).toUpperCase()}
      </div>
      <div className="epic-detail__header-content">
        <h2 className="epic-detail__name">{group.name}</h2>
        {group.goal && <p className="epic-detail__goal">{group.goal}</p>}
      </div>
      <div className="epic-detail__header-actions" style={{ position: 'relative' }} ref={menuRef}>
        <button
          type="button"
          className="epic-detail__header-btn epic-detail__header-btn--ai"
          onClick={onOpenAssistant}
          aria-label="Ask AI"
        >
          ✦ Ask AI
        </button>
        <button
          type="button"
          className="epic-detail__header-btn"
          onClick={() => setShowOverflowMenu(!showOverflowMenu)}
          aria-label="More options"
          aria-expanded={showOverflowMenu}
          aria-haspopup="menu"
        >
          <MoreVertical size={16} />
        </button>
        {showOverflowMenu && (
          <div
            className="epic-detail__overflow-menu"
            role="menu"
            onKeyDown={handleMenuKeyDown}
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: 'var(--fleet-bg)',
              border: `1px solid ${'var(--fleet-accent)'}40`,
              borderRadius: '4px',
              minWidth: '160px',
              zIndex: 100,
              boxShadow: 'none'
            }}
          >
            <button
              ref={(el): void => {
                if (el) menuItemsRef.current[0] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="epic-detail__overflow-item epic-menu__item epic-menu__item--default"
              onClick={handleEditClick}
            >
              <Edit2 size={14} />
              Edit
            </button>
            <button
              ref={(el): void => {
                if (el) menuItemsRef.current[1] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="epic-detail__overflow-item epic-menu__item epic-menu__item--default"
              onClick={handleToggleReadyClick}
            >
              {isReady ? 'Mark as Draft' : 'Mark as Ready'}
            </button>
            <button
              ref={(el): void => {
                if (el) menuItemsRef.current[2] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="epic-detail__overflow-item epic-menu__item epic-menu__item--default"
              onClick={handleTogglePauseClick}
            >
              {group.is_paused ? 'Resume Epic' : 'Pause Epic'}
            </button>
            {!isCompleted && (
              <button
                ref={(el): void => {
                  if (el) menuItemsRef.current[3] = el
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="epic-detail__overflow-item epic-menu__item epic-menu__item--success"
                onClick={handleMarkCompletedClick}
              >
                <CheckCircle2 size={14} />
                Mark as Completed
              </button>
            )}
            <button
              ref={(el): void => {
                if (el) menuItemsRef.current[isCompleted ? 3 : 4] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="epic-detail__overflow-item epic-menu__item epic-menu__item--danger"
              onClick={handleDeleteClick}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {totalCount > 0 && (
        <div className="epic-detail__header-stripe">
          <div
            className="epic-detail__header-stripe-fill"
            style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
