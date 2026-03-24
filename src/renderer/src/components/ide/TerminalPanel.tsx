import { useCallback } from 'react'
import { TerminalTabBar } from '../terminal/TerminalTabBar'
import { TerminalToolbar } from '../terminal/TerminalToolbar'
import { TerminalContent } from '../terminal/TerminalContent'
import { clearTerminal } from '../terminal/TerminalPane'
import { useTerminalStore } from '../../stores/terminal'
import { useUIStore } from '../../stores/ui'

export function TerminalPanel(): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const addTab = useTerminalStore((s) => s.addTab)
  const closeTab = useTerminalStore((s) => s.closeTab)
  const setActiveTab = useTerminalStore((s) => s.setActiveTab)
  const renameTab = useTerminalStore((s) => s.renameTab)
  const reorderTab = useTerminalStore((s) => s.reorderTab)
  const splitEnabled = useTerminalStore((s) => s.splitEnabled)
  const toggleSplit = useTerminalStore((s) => s.toggleSplit)
  const showFind = useTerminalStore((s) => s.showFind)
  const createAgentTab = useTerminalStore((s) => s.createAgentTab)
  const activeView = useUIStore((s) => s.activeView)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isAgentTab = activeTab?.kind === 'agent'

  const handleClear = useCallback(() => {
    if (activeTabId && !isAgentTab) clearTerminal(activeTabId)
  }, [activeTabId, isAgentTab])

  const handleCloseOthers = useCallback((keepId: string) => {
    const { tabs: currentTabs } = useTerminalStore.getState()
    currentTabs.forEach((tab) => { if (tab.id !== keepId) closeTab(tab.id) })
  }, [closeTab])

  const handleCloseAll = useCallback(() => {
    const { tabs: currentTabs } = useTerminalStore.getState()
    currentTabs.slice(1).forEach((tab) => closeTab(tab.id))
  }, [closeTab])

  return (
    <div className="ide-terminal-panel">
      <div className="terminal-tab-bar">
        <TerminalTabBar tabs={tabs} activeTabId={activeTabId} onSelectTab={setActiveTab}
          onCloseTab={closeTab} onAddTab={addTab} onCreateAgentTab={createAgentTab}
          onRenameTab={renameTab} onReorderTab={reorderTab}
          onCloseOthers={handleCloseOthers} onCloseAll={handleCloseAll} />
        <TerminalToolbar isAgentTab={!!isAgentTab} splitEnabled={splitEnabled}
          onClear={handleClear} onToggleSplit={toggleSplit} />
      </div>
      <TerminalContent tabs={tabs} activeTabId={activeTabId} splitEnabled={splitEnabled}
        showFind={showFind} isAgentTab={!!isAgentTab} activeView={activeView} />
    </div>
  )
}
