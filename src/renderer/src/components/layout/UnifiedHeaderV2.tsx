import './UnifiedHeaderV2.css'
import { useMemo } from 'react'
import { Sun, Moon, Plus } from 'lucide-react'
import { useCommandPaletteStore } from '../../stores/commandPalette'
import { useThemeStore } from '../../stores/theme'
import { usePanelLayoutStore, findLeaf } from '../../stores/panelLayout'
import { useSprintTasks } from '../../stores/sprintTasks'
import { NotificationBell } from './NotificationBell'
import { HeaderTab } from './HeaderTab'
import { HealthChip } from './HealthChip'
import { TokenChip } from './TokenChip'
import { CommandPill } from './CommandPill'
import { useTearoffDrag } from '../../hooks/useTearoffDrag'
import { useRovingTabIndex } from '../../hooks/useRovingTabIndex'

export function UnifiedHeaderV2(): React.JSX.Element {
  const openCommandPalette = useCommandPaletteStore((s) => s.open)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const setView = usePanelLayoutStore((s) => s.setView)

  // Single-pass reduction — avoids traversing the task list three times per render.
  const tasks = useSprintTasks((s) => s.tasks)
  const { activeCount, queuedCount, failedCount } = useMemo(() => {
    let active = 0
    let queued = 0
    let failed = 0
    for (const t of tasks) {
      if (t.status === 'active') active++
      else if (t.status === 'queued') queued++
      else if (t.status === 'failed' || t.status === 'error') failed++
    }
    return { activeCount: active, queuedCount: queued, failedCount: failed }
  }, [tasks])

  const managerState: 'running' | 'error' | 'idle' =
    failedCount > 0 ? 'error' : activeCount > 0 ? 'running' : 'idle'

  const root = usePanelLayoutStore((s) => s.root)
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const closeTab = usePanelLayoutStore((s) => s.closeTab)
  const setActiveTab = usePanelLayoutStore((s) => s.setActiveTab)

  const focusedPanel = focusedPanelId ? findLeaf(root, focusedPanelId) : null
  const tabs = focusedPanel?.tabs ?? []
  const activeTabIndex = focusedPanel?.activeTab ?? 0

  // window.location.search is set once at window open; parsing it once per mount avoids the
  // alloc + parse cost on every render without introducing a render-time ref read.
  const tearoffWindowId = useMemo(
    () => new URLSearchParams(window.location.search).get('windowId'),
    []
  )
  const { startDrag } = useTearoffDrag(tearoffWindowId ?? undefined)

  const handleBrandClick = (): void => setView('dashboard')
  const handleTabClick = (index: number): void => {
    if (focusedPanelId) setActiveTab(focusedPanelId, index)
  }
  const handleTabClose = (index: number): void => {
    if (focusedPanelId) closeTab(focusedPanelId, index)
  }

  const { getTabProps } = useRovingTabIndex({
    count: tabs.length,
    activeIndex: activeTabIndex,
    onSelect: handleTabClick,
  })

  const handleBrandKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleBrandClick()
    }
  }

  return (
    <header className="unified-header-v2">
      {/* Brand block — 200px, matches sidebar width */}
      <div className="unified-header-v2__brand">
        <button
          className="unified-header-v2__logo-btn"
          onClick={handleBrandClick}
          onKeyDown={handleBrandKeyDown}
          aria-label="Go to Dashboard"
          data-testid="header-logo"
        >
          <span className="unified-header-v2__mark">F</span>
          <span className="unified-header-v2__wordmark">FLEET</span>
        </button>
      </div>

      {/* Tab strip */}
      <div className="unified-header-v2__tabs" role="tablist">
        {tabs.map((tab, index) => {
          const tabProps = getTabProps(index)
          return (
            <HeaderTab
              key={`${tab.viewKey}-${index}`}
              label={tab.label}
              isActive={index === activeTabIndex}
              onClick={() => handleTabClick(index)}
              onClose={() => handleTabClose(index)}
              showClose={tabs.length > 1}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/fleet-panel',
                  JSON.stringify({ sourcePanelId: focusedPanelId ?? '', sourceTabIndex: index })
                )
                startDrag({
                  sourcePanelId: focusedPanelId ?? '',
                  sourceTabIndex: index,
                  viewKey: tab.viewKey,
                })
              }}
              {...tabProps}
            />
          )
        })}
      </div>

      {/* + Add tab — opens command palette to let the user pick a view */}
      <button
        className="unified-header-v2__add-tab"
        onClick={openCommandPalette}
        title="Add tab (⌘K)"
        aria-label="Add tab"
        data-testid="header-add-tab"
      >
        <Plus size={12} />
      </button>

      {/* Global controls */}
      <div className="unified-header-v2__actions">
        <CommandPill />
        <HealthChip
          managerState={managerState}
          activeCount={activeCount}
          queuedCount={queuedCount}
          failedCount={failedCount}
          onClick={() => setView('sprint')}
        />
        <TokenChip />
        <NotificationBell />
        <button
          className="unified-header-v2__icon-btn"
          onClick={toggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
          data-testid="theme-toggle"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  )
}
