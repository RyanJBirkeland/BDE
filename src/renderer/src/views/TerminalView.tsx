import { useCallback, useEffect } from 'react'
import { TerminalTabBar } from '../components/terminal/TerminalTabBar'
import { TerminalToolbar } from '../components/terminal/TerminalToolbar'
import { TerminalContent } from '../components/terminal/TerminalContent'
import { clearTerminal } from '../components/terminal/TerminalPane'
import { useTerminalStore } from '../stores/terminal'
import { useUIStore } from '../stores/ui'

export function TerminalView(): React.JSX.Element {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, splitEnabled, toggleSplit, showFind, createAgentTab } = useTerminalStore()
  const activeView = useUIStore((s) => s.activeView)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isAgentTab = activeTab?.kind === 'agent'

  const handleClear = useCallback(() => {
    if (activeTabId && !isAgentTab) clearTerminal(activeTabId)
  }, [activeTabId, isAgentTab])

  // Keyboard shortcuts — capture phase so they fire before App.tsx global handler
  useEffect(() => {
    if (activeView !== 'terminal') return

    const handler = (e: KeyboardEvent): void => {
      if (!e.metaKey) return

      if (e.key === 't') {
        e.preventDefault()
        e.stopPropagation()
        useTerminalStore.getState().addTab()
        return
      }

      if (e.key === 'w') {
        e.preventDefault()
        e.stopPropagation()
        const { activeTabId: id } = useTerminalStore.getState()
        if (id) useTerminalStore.getState().closeTab(id)
        return
      }

      if (e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        const { activeTabId: id } = useTerminalStore.getState()
        if (id) clearTerminal(id)
        return
      }

      if (e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        const store = useTerminalStore.getState()
        const currentTab = store.tabs.find((t) => t.id === store.activeTabId)
        if (currentTab?.kind === 'shell') {
          store.setShowFind(!store.showFind)
        }
        return
      }

      if (e.shiftKey && e.key === 'D') {
        e.preventDefault()
        e.stopPropagation()
        useTerminalStore.getState().toggleSplit()
        return
      }

      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1
        const { tabs: currentTabs } = useTerminalStore.getState()
        if (idx < currentTabs.length) {
          e.preventDefault()
          e.stopPropagation()
          useTerminalStore.getState().setActiveTab(currentTabs[idx].id)
        }
        return
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activeView])

  return (
    <div className="terminal-view">
      <div className="terminal-view__header">
        <span className="terminal-view__title">Terminal</span>
      </div>

      <div className="terminal-tab-bar">
        <TerminalTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTab}
          onCloseTab={closeTab}
          onAddTab={addTab}
          onCreateAgentTab={createAgentTab}
        />
        <TerminalToolbar
          isAgentTab={!!isAgentTab}
          splitEnabled={splitEnabled}
          onClear={handleClear}
          onToggleSplit={toggleSplit}
        />
      </div>

      <TerminalContent
        tabs={tabs}
        activeTabId={activeTabId}
        splitEnabled={splitEnabled}
        showFind={showFind}
        isAgentTab={!!isAgentTab}
        activeView={activeView}
      />
    </div>
  )
}
