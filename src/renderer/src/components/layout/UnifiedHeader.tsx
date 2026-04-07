import { useMemo } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useThemeStore } from '../../stores/theme'
import { usePanelLayoutStore, findLeaf } from '../../stores/panelLayout'
import { useCostDataStore } from '../../stores/costData'
import { useSprintTasks } from '../../stores/sprintTasks'
import { NeonBadge } from '../neon/NeonBadge'
import { formatTokens } from '../../lib/format'
import { NotificationBell } from './NotificationBell'
import { HeaderTab } from './HeaderTab'
import { HealthStrip } from './HealthStrip'
import { useTearoffDrag } from '../../hooks/useTearoffDrag'
import { useRovingTabIndex } from '../../hooks/useRovingTabIndex'

export function UnifiedHeader(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const totalTokens = useCostDataStore((s) => s.totalTokens)
  const setView = usePanelLayoutStore((s) => s.setView)

  // Health strip counts — single-pass reduction so we don't traverse the
  // task list three times on every render (matters at thousands of tasks).
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
  const hasError = failedCount > 0
  const managerState: 'running' | 'error' | 'idle' = hasError
    ? 'error'
    : activeCount > 0
      ? 'running'
      : 'idle'

  const root = usePanelLayoutStore((s) => s.root)
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const closeTab = usePanelLayoutStore((s) => s.closeTab)
  const setActiveTab = usePanelLayoutStore((s) => s.setActiveTab)

  // Get the focused panel's tabs
  const focusedPanel = focusedPanelId ? findLeaf(root, focusedPanelId) : null
  const tabs = focusedPanel?.tabs ?? []
  const activeTabIndex = focusedPanel?.activeTab ?? 0

  const tearoffWindowId = new URLSearchParams(window.location.search).get('windowId')
  const { startDrag } = useTearoffDrag(tearoffWindowId ?? undefined)

  const handleLogoClick = (): void => {
    setView('dashboard')
  }

  const handleTabClick = (index: number): void => {
    if (focusedPanelId) {
      setActiveTab(focusedPanelId, index)
    }
  }

  const handleTabClose = (index: number): void => {
    if (focusedPanelId) {
      closeTab(focusedPanelId, index)
    }
  }

  const { getTabProps } = useRovingTabIndex({
    count: tabs.length,
    activeIndex: activeTabIndex,
    onSelect: handleTabClick
  })

  const handleLogoKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleLogoClick()
    }
  }

  return (
    <div className="unified-header">
      {/* Left zone — matches sidebar width (52px), contains logo + traffic light clearance */}
      <div className="unified-header__traffic-lights">
        <div
          className="unified-header__logo"
          onClick={handleLogoClick}
          onKeyDown={handleLogoKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Go to Dashboard"
        >
          <span className="unified-header__logo-letter">B</span>
        </div>
      </div>

      {/* Tab strip - flex:1 */}
      <div className="unified-header__tabs" role="tablist">
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
                  'application/bde-panel',
                  JSON.stringify({ sourcePanelId: focusedPanelId ?? '', sourceTabIndex: index })
                )
                startDrag({
                  sourcePanelId: focusedPanelId ?? '',
                  sourceTabIndex: index,
                  viewKey: tab.viewKey
                })
              }}
              {...tabProps}
            />
          )
        })}
      </div>

      {/* Action buttons */}
      <div className="unified-header__actions">
        <HealthStrip
          managerState={managerState}
          activeCount={activeCount}
          queuedCount={queuedCount}
          failedCount={failedCount}
          onClick={() => setView('sprint')}
        />
        <NeonBadge accent="cyan" label={`${formatTokens(totalTokens)} tokens`} />
        <NotificationBell />
        <button
          className="bde-btn bde-btn--icon bde-btn--sm"
          onClick={toggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </div>
  )
}
