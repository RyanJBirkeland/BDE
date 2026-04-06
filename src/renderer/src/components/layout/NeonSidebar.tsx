import React, { useState, useRef } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { SidebarItem } from './SidebarItem'
import { OverflowMenu } from './OverflowMenu'
import { NavTooltip } from '../ui/NavTooltip'
import { useSidebarStore, getUnpinnedViews } from '../../stores/sidebar'
import { usePanelLayoutStore, getOpenViews, type View } from '../../stores/panelLayout'
import { VIEW_REGISTRY } from '../../lib/view-registry'
import { useSprintTasks } from '../../stores/sprintTasks'

interface NeonSidebarProps {
  model?: string
}

export function NeonSidebar({ model }: NeonSidebarProps): React.JSX.Element {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

  const pinnedViews = useSidebarStore((s) => s.pinnedViews)
  const pinView = useSidebarStore((s) => s.pinView)
  const unpinView = useSidebarStore((s) => s.unpinView)

  const {
    root,
    focusedPanelId,
    activeView,
    setView,
    splitPanel,
    addTab,
    closeTab,
    findPanelByView
  } = usePanelLayoutStore(
    useShallow((s) => ({
      root: s.root,
      focusedPanelId: s.focusedPanelId,
      activeView: s.activeView,
      setView: s.setView,
      splitPanel: s.splitPanel,
      addTab: s.addTab,
      closeTab: s.closeTab,
      findPanelByView: s.findPanelByView
    }))
  )

  const reviewCount = useSprintTasks((s) => s.tasks.filter((t) => t.status === 'review').length)
  const failedCount = useSprintTasks(
    (s) => s.tasks.filter((t) => t.status === 'failed' || t.status === 'error').length
  )

  const openViews = getOpenViews(root)
  const unpinnedViews = getUnpinnedViews(pinnedViews)

  const handleActivate = (view: View): void => {
    setView(view)
  }

  const handleContextAction = (action: string, view: View): void => {
    switch (action) {
      case 'unpin':
        unpinView(view)
        break
      case 'open-right':
        if (focusedPanelId) {
          splitPanel(focusedPanelId, 'horizontal', view)
        }
        break
      case 'open-below':
        if (focusedPanelId) {
          splitPanel(focusedPanelId, 'vertical', view)
        }
        break
      case 'open-tab':
        if (focusedPanelId) {
          addTab(focusedPanelId, view)
        }
        break
      case 'open-window': {
        // Tear off view into a new window
        if (!window.api?.tearoff) break
        // Find the panel containing this view so it can be removed from main
        const panel = findPanelByView(view)
        const tabIdx = panel?.tabs.findIndex((t) => t.viewKey === view) ?? -1
        const x = window.screenX + Math.round(window.innerWidth / 2)
        const y = window.screenY + Math.round(window.innerHeight / 2)
        window.api.tearoff.create({
          view,
          screenX: x,
          screenY: y,
          sourcePanelId: panel?.panelId ?? '',
          sourceTabIndex: tabIdx
        })
        break
      }
      case 'close-all': {
        // Repeatedly close any panel containing this view until none remain
        let leaf = findPanelByView(view)
        while (leaf) {
          const tabIdx = leaf.tabs.findIndex((t) => t.viewKey === view)
          if (tabIdx >= 0) {
            closeTab(leaf.panelId, tabIdx)
          }
          leaf = usePanelLayoutStore.getState().findPanelByView(view)
        }
        break
      }
    }
  }

  const handlePin = (view: View): void => {
    pinView(view)
  }

  const toggleOverflow = (): void => {
    if (!overflowOpen && moreButtonRef.current) {
      setAnchorRect(moreButtonRef.current.getBoundingClientRect())
    }
    setOverflowOpen(!overflowOpen)
  }

  return (
    <div className="neon-sidebar">
      <nav className="neon-sidebar__nav">
        {pinnedViews.map((view) => {
          const meta = VIEW_REGISTRY[view]
          const Icon = meta.icon
          const isActive = activeView === view
          const isOpen = openViews.includes(view) && !isActive

          return (
            <NavTooltip
              key={view}
              label={meta.label}
              description={meta.description}
              shortcut={meta.shortcut}
            >
              <SidebarItem
                view={view}
                icon={<Icon size={18} strokeWidth={1.5} />}
                label={meta.label}
                shortcut={meta.shortcut}
                isActive={isActive}
                isOpen={isOpen}
                badge={
                  view === 'code-review' ? reviewCount : view === 'sprint' ? failedCount : undefined
                }
                badgeAccent={
                  view === 'code-review' ? 'blue' : view === 'sprint' ? 'red' : undefined
                }
                onActivate={handleActivate}
                onContextAction={handleContextAction}
              />
            </NavTooltip>
          )
        })}

        {/* More button */}
        {unpinnedViews.length > 0 && (
          <button
            ref={moreButtonRef}
            className="sidebar-item"
            onClick={toggleOverflow}
            aria-label="More views"
            aria-expanded={overflowOpen}
          >
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </button>
        )}
      </nav>

      <div className="neon-sidebar__footer">
        {model && <div className="sidebar-model-badge">{model}</div>}
      </div>

      {/* Overflow menu */}
      {overflowOpen && anchorRect && (
        <OverflowMenu
          unpinnedViews={unpinnedViews}
          anchorRect={anchorRect}
          onPin={handlePin}
          onActivate={(view): void => {
            handleActivate(view)
            setOverflowOpen(false)
          }}
          onClose={(): void => setOverflowOpen(false)}
        />
      )}
    </div>
  )
}
