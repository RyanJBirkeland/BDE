import { Sun, Moon } from 'lucide-react'
import { useThemeStore } from '../../stores/theme'
import { usePanelLayoutStore, findLeaf } from '../../stores/panelLayout'
import { useUIStore } from '../../stores/ui'
import { useCostDataStore } from '../../stores/costData'
import { NeonBadge } from '../neon/NeonBadge'
import { NotificationBell } from './NotificationBell'
import { HeaderTab } from './HeaderTab'

export function UnifiedHeader(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const totalCost = useCostDataStore((s) => s.totalCost)
  const setView = useUIStore((s) => s.setView)

  const root = usePanelLayoutStore((s) => s.root)
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const closeTab = usePanelLayoutStore((s) => s.closeTab)
  const setActiveTab = usePanelLayoutStore((s) => s.setActiveTab)

  // Get the focused panel's tabs
  const focusedPanel = focusedPanelId ? findLeaf(root, focusedPanelId) : null
  const tabs = focusedPanel?.tabs ?? []
  const activeTabIndex = focusedPanel?.activeTab ?? 0

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

  return (
    <div className="unified-header">
      {/* Logo zone - 52px */}
      <div className="unified-header__logo" onClick={handleLogoClick}>
        <span className="unified-header__logo-letter">B</span>
      </div>

      {/* Tab strip - flex:1 */}
      <div className="unified-header__tabs">
        {tabs.map((tab, index) => (
          <HeaderTab
            key={`${tab.viewKey}-${index}`}
            label={tab.label}
            isActive={index === activeTabIndex}
            onClick={() => handleTabClick(index)}
            onClose={() => handleTabClose(index)}
            showClose={tabs.length > 1}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div className="unified-header__actions">
        <NeonBadge accent="cyan" label={`$${totalCost.toFixed(2)}`} />
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
