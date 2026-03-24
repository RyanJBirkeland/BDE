import { useState, useMemo } from 'react'
import {
  Terminal,
  SquareTerminal,
  GitBranch,
  GitPullRequest,
  Brain,
  DollarSign,
  Settings
} from 'lucide-react'
import { useUIStore, View } from '../../stores/ui'
import { usePanelLayoutStore, findLeaf } from '../../stores/panelLayout'
import { tokens } from '../../design-system/tokens'

const NAV_ITEMS: { view: View; icon: typeof Terminal; label: string; shortcut: string }[] = [
  { view: 'agents', icon: Terminal, label: 'Agents', shortcut: '⌘1' },
  { view: 'terminal', icon: SquareTerminal, label: 'Terminal', shortcut: '⌘2' },
  { view: 'sprint', icon: GitBranch, label: 'Sprint Center', shortcut: '⌘3' },
  { view: 'pr-station', icon: GitPullRequest, label: 'PR Station', shortcut: '⌘4' },
  { view: 'memory', icon: Brain, label: 'Memory', shortcut: '⌘5' },
  { view: 'cost', icon: DollarSign, label: 'Cost Tracker', shortcut: '⌘6' },
  { view: 'settings', icon: Settings, label: 'Settings', shortcut: '⌘7' }
]

interface ActivityBarProps {
  // Reserved for future auth status
}

interface ContextMenuState {
  x: number
  y: number
  view: View
}

export function ActivityBar(_props: ActivityBarProps): React.JSX.Element {
  // Keep legacy view switching for fallback compatibility
  const setView = useUIStore((s) => s.setView)

  const root = usePanelLayoutStore((s) => s.root)
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const openViews = useMemo(() => {
    const collect = (node: import('../../stores/panelLayout').PanelNode): View[] => {
      if (node.type === 'leaf') return node.tabs.map((t) => t.viewKey)
      return [...collect(node.children[0]), ...collect(node.children[1])]
    }
    return collect(root)
  }, [root])

  const focusedLeaf = focusedPanelId ? findLeaf(root, focusedPanelId) : null
  const focusedView = focusedLeaf?.tabs[focusedLeaf.activeTab]?.viewKey

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  function handleClick(view: View): void {
    setView(view)
    const store = usePanelLayoutStore.getState()
    const existing = store.findPanelByView(view)
    if (existing) {
      store.focusPanel(existing.panelId)
      const leaf = findLeaf(store.root, existing.panelId)
      if (leaf) {
        const tabIdx = leaf.tabs.findIndex((t) => t.viewKey === view)
        if (tabIdx >= 0) store.setActiveTab(existing.panelId, tabIdx)
      }
    } else {
      const targetId = store.focusedPanelId
      if (targetId) {
        store.addTab(targetId, view)
      }
    }
  }

  function handleContextMenu(e: React.MouseEvent, view: View): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, view })
  }

  function closeContextMenu(): void {
    setContextMenu(null)
  }

  function handleCloseAll(view: View): void {
    const store = usePanelLayoutStore.getState()
    // Repeatedly close any panel containing this view until none remain
    let leaf = store.findPanelByView(view)
    while (leaf) {
      const tabIdx = leaf.tabs.findIndex((t) => t.viewKey === view)
      if (tabIdx >= 0) {
        store.closeTab(leaf.panelId, tabIdx)
      }
      leaf = usePanelLayoutStore.getState().findPanelByView(view)
    }
    closeContextMenu()
  }

  return (
    <nav className="activity-bar" aria-label="Views" onClick={contextMenu ? closeContextMenu : undefined}>
      <div className="activity-bar__nav">
        {NAV_ITEMS.map(({ view, icon: Icon, label, shortcut }) => (
          <button
            key={view}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/bde-panel', JSON.stringify({ viewKey: view }))
              e.dataTransfer.setData('text/plain', label)
            }}
            className={
              'activity-bar__item ' + (focusedView === view ? 'activity-bar__item--active' : '')
            }
            onClick={(e) => {
              e.stopPropagation()
              handleClick(view)
            }}
            onContextMenu={(e) => handleContextMenu(e, view)}
            aria-label={label}
            aria-current={focusedView === view ? 'page' : undefined}
            title={label + ' (' + shortcut + ')'}
            style={{ position: 'relative' }}
          >
            <Icon size={18} strokeWidth={1.5} />
            <span className="activity-bar__item-label">{label}</span>
            {openViews.includes(view) && (
              <span
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '4px',
                  height: '4px',
                  borderRadius: tokens.radius.full,
                  backgroundColor: tokens.color.accent,
                  pointerEvents: 'none',
                }}
              />
            )}
          </button>
        ))}
      </div>

      {contextMenu && (
        <>
          {/* Invisible overlay to catch outside clicks */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999,
            }}
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeContextMenu()
            }}
          />
          <div
            role="menu"
            aria-label="View options"
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 1000,
              backgroundColor: tokens.color.surfaceHigh,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.md,
              boxShadow: tokens.shadow.md,
              padding: `${tokens.space[1]} 0`,
              minWidth: '180px',
            }}
          >
            {[
              {
                label: 'Open to the Right',
                action: (): void => {
                  const store = usePanelLayoutStore.getState()
                  const targetId = store.focusedPanelId
                  if (targetId) store.splitPanel(targetId, 'horizontal', contextMenu.view)
                  closeContextMenu()
                },
              },
              {
                label: 'Open Below',
                action: (): void => {
                  const store = usePanelLayoutStore.getState()
                  const targetId = store.focusedPanelId
                  if (targetId) store.splitPanel(targetId, 'vertical', contextMenu.view)
                  closeContextMenu()
                },
              },
              {
                label: 'Open in New Tab',
                action: (): void => {
                  const store = usePanelLayoutStore.getState()
                  const targetId = store.focusedPanelId
                  if (targetId) store.addTab(targetId, contextMenu.view)
                  closeContextMenu()
                },
              },
              {
                label: 'Close All',
                action: (): void => handleCloseAll(contextMenu.view),
              },
            ].map(({ label, action }) => (
              <button
                key={label}
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  action()
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: `${tokens.space[1]} ${tokens.space[3]}`,
                  background: 'none',
                  border: 'none',
                  color: tokens.color.text,
                  fontSize: tokens.size.sm,
                  cursor: 'pointer',
                  fontFamily: tokens.font.ui,
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    tokens.color.accentDim
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </nav>
  )
}
