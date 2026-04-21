import { useState, useRef, useCallback, useEffect } from 'react'
import { Plus, ChevronDown, X, Bot, ChevronLeft, ChevronRight } from 'lucide-react'
import { ShellPicker } from './ShellPicker'
import { AgentPicker } from './AgentPicker'
import { useRovingTabIndex } from '../../hooks/useRovingTabIndex'
import type { TerminalTab } from '../../stores/terminal'

interface TerminalTabBarProps {
  tabs: TerminalTab[]
  activeTabId: string
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onAddTab: (shell?: string) => void
  onCreateAgentTab: (agentId: string, label: string, sessionKey: string) => void
  onRenameTab?: ((id: string, title: string) => void) | undefined
  onReorderTab?: ((fromIdx: number, toIdx: number) => void) | undefined
  onDuplicateTab?: ((id: string) => void) | undefined
  onCloseOthers?: ((id: string) => void) | undefined
  onCloseAll?: (() => void) | undefined
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onCreateAgentTab,
  onRenameTab,
  onReorderTab,
  onDuplicateTab,
  onCloseOthers,
  onCloseAll
}: TerminalTabBarProps): React.JSX.Element {
  const [showShellPicker, setShowShellPicker] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(
    null
  )
  const [draggedTabIdx, setDraggedTabIdx] = useState<number | null>(null)
  const [showLeftScroll, setShowLeftScroll] = useState(false)
  const [showRightScroll, setShowRightScroll] = useState(false)
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Check for overflow and show scroll arrows
  const checkOverflow = useCallback(() => {
    const container = tabsContainerRef.current
    if (!container) return
    const hasOverflow = container.scrollWidth > container.clientWidth
    setShowLeftScroll(hasOverflow && container.scrollLeft > 0)
    setShowRightScroll(
      hasOverflow && container.scrollLeft < container.scrollWidth - container.clientWidth
    )
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkOverflow()
    window.addEventListener('resize', checkOverflow)
    return () => window.removeEventListener('resize', checkOverflow)
  }, [checkOverflow, tabs])

  useEffect(() => {
    const container = tabsContainerRef.current
    if (!container) return
    container.addEventListener('scroll', checkOverflow)
    return () => container.removeEventListener('scroll', checkOverflow)
  }, [checkOverflow])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingTabId])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (): void => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  // Auto-focus first menu item when context menu opens
  useEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      const firstItem = contextMenuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')
      firstItem?.focus()
    }
  }, [contextMenu])

  // Keyboard navigation for context menu
  const handleContextMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    const menu = contextMenuRef.current
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
      case 'Enter':
      case ' ':
        e.preventDefault()
        ;(e.target as HTMLElement).click()
        break
      case 'Escape':
        e.preventDefault()
        setContextMenu(null)
        break
    }
  }, [])

  const handleDoubleClick = (tab: TerminalTab): void => {
    if (!onRenameTab) return
    setEditingTabId(tab.id)
    setEditValue(tab.title)
  }

  const handleRenameSubmit = (): void => {
    if (editingTabId && onRenameTab && editValue.trim()) {
      onRenameTab(editingTabId, editValue.trim())
    }
    setEditingTabId(null)
    setEditValue('')
  }

  const handleRenameCancel = (): void => {
    setEditingTabId(null)
    setEditValue('')
  }

  const handleContextMenu = (e: React.MouseEvent, tab: TerminalTab): void => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
  }

  const handleMiddleClick = (e: React.MouseEvent, tabId: string): void => {
    if (e.button === 1) {
      e.preventDefault()
      onCloseTab(tabId)
    }
  }

  const handleDragStart = (e: React.DragEvent, idx: number): void => {
    setDraggedTabIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetIdx: number): void => {
    e.preventDefault()
    if (draggedTabIdx !== null && draggedTabIdx !== targetIdx && onReorderTab) {
      onReorderTab(draggedTabIdx, targetIdx)
    }
    setDraggedTabIdx(null)
  }

  const scrollTabs = (direction: 'left' | 'right'): void => {
    const container = tabsContainerRef.current
    if (!container) return
    const scrollAmount = 200
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    })
  }

  const getStatusDotColor = (tab: TerminalTab): string => {
    if (tab.hasUnread) return 'var(--bde-info)'
    if (tab.kind === 'agent') return 'var(--bde-subagent)'
    if (tab.status === 'exited') return 'var(--bde-text-dim)'
    return 'var(--bde-accent)'
  }

  // Roving tabindex for keyboard navigation
  const activeTabIdx = tabs.findIndex((t) => t.id === activeTabId)
  const { getTabProps } = useRovingTabIndex({
    count: tabs.length,
    activeIndex: activeTabIdx,
    onSelect: (index) => {
      const tab = tabs[index]
      if (tab) onSelectTab(tab.id)
    }
  })

  return (
    <>
      <div className="terminal-tab-bar">
        {showLeftScroll && (
          <button
            className="terminal-tab-bar__scroll terminal-tab-bar__scroll--left"
            onClick={() => scrollTabs('left')}
          >
            <ChevronLeft size={16} />
          </button>
        )}

        <div
          ref={tabsContainerRef}
          className="terminal-tab-bar__tabs"
          role="tablist"
          aria-label="Terminal tabs"
          onScroll={checkOverflow}
        >
          {tabs.map((tab, idx) => {
            const isActive = tab.id === activeTabId
            const isAgent = tab.kind === 'agent'
            const isEditing = editingTabId === tab.id
            const tabClass = [
              'terminal-tab',
              isActive && 'terminal-tab--active',
              isAgent && 'terminal-tab--agent',
              isEditing && 'terminal-tab--editing'
            ]
              .filter(Boolean)
              .join(' ')

            const tabProps = getTabProps(idx)

            return (
              <div
                key={tab.id}
                className={tabClass}
                role="tab"
                aria-selected={isActive}
                tabIndex={tabProps.tabIndex}
                onClick={() => !isEditing && onSelectTab(tab.id)}
                onDoubleClick={() => !isEditing && handleDoubleClick(tab)}
                onContextMenu={(e) => handleContextMenu(e, tab)}
                onMouseDown={(e) => handleMiddleClick(e, tab.id)}
                onKeyDown={(e) => !isEditing && tabProps.onKeyDown(e)}
                draggable={!isEditing}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
              >
                <span
                  className="terminal-tab__status-dot"
                  style={{ backgroundColor: getStatusDotColor(tab) }}
                />
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    className="terminal-tab__edit-input"
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSubmit()
                      if (e.key === 'Escape') handleRenameCancel()
                    }}
                    onBlur={handleRenameSubmit}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="terminal-tab__title">{tab.title}</span>
                )}
                {tabs.length > 1 && (
                  <button
                    className="terminal-tab__close"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                    aria-label={`Close ${tab.title}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {showRightScroll && (
          <button
            className="terminal-tab-bar__scroll terminal-tab-bar__scroll--right"
            onClick={() => scrollTabs('right')}
          >
            <ChevronRight size={16} />
          </button>
        )}

        <div className="terminal-tab-bar__actions">
          <div className="terminal-tab-bar__btn-group">
            <button
              className="terminal-tab-bar__btn terminal-tab-bar__btn--add"
              onClick={() => onAddTab()}
              title="New terminal (⌘T)"
            >
              <Plus size={16} />
            </button>
            <button
              className="terminal-tab-bar__btn terminal-tab-bar__btn--shell"
              onClick={() => setShowShellPicker(!showShellPicker)}
              title="Choose shell"
            >
              <ChevronDown size={12} />
            </button>
            {showShellPicker && (
              <ShellPicker
                onSelect={(shell) => {
                  setShowShellPicker(false)
                  onAddTab(shell || undefined)
                }}
                onClose={() => setShowShellPicker(false)}
              />
            )}
          </div>

          <div className="terminal-tab-bar__btn-group">
            <button
              className="terminal-tab-bar__btn terminal-tab-bar__btn--agent"
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              title="Watch agent output"
            >
              <Bot size={16} />
            </button>
            {showAgentPicker && (
              <AgentPicker
                onSelect={(agentId, label) => {
                  setShowAgentPicker(false)
                  onCreateAgentTab(agentId, label, agentId)
                }}
                onClose={() => setShowAgentPicker(false)}
              />
            )}
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="Tab actions"
          className="terminal-tab-bar__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleContextMenuKeyDown}
        >
          {onRenameTab && (
            <button
              role="menuitem"
              tabIndex={-1}
              className="terminal-tab-bar__context-menu-item"
              onClick={() => {
                const tab = tabs.find((t) => t.id === contextMenu.tabId)
                if (tab) handleDoubleClick(tab)
                setContextMenu(null)
              }}
            >
              Rename
            </button>
          )}
          {onDuplicateTab && (
            <button
              role="menuitem"
              tabIndex={-1}
              className="terminal-tab-bar__context-menu-item"
              onClick={() => {
                onDuplicateTab(contextMenu.tabId)
                setContextMenu(null)
              }}
            >
              Duplicate
            </button>
          )}
          {onCloseOthers && tabs.length > 1 && (
            <button
              role="menuitem"
              tabIndex={-1}
              className="terminal-tab-bar__context-menu-item"
              onClick={() => {
                onCloseOthers(contextMenu.tabId)
                setContextMenu(null)
              }}
            >
              Close Others
            </button>
          )}
          {onCloseAll && tabs.length > 1 && (
            <button
              role="menuitem"
              tabIndex={-1}
              className="terminal-tab-bar__context-menu-item"
              onClick={() => {
                onCloseAll()
                setContextMenu(null)
              }}
            >
              Close All
            </button>
          )}
        </div>
      )}
    </>
  )
}
