import { useCallback, useEffect } from 'react'
import { TerminalTabBar } from '../components/terminal/TerminalTabBar'
import { TerminalToolbar } from '../components/terminal/TerminalToolbar'
import { TerminalContent } from '../components/terminal/TerminalContent'
import { clearTerminal } from '../components/terminal/TerminalPane'
import { useTerminalStore } from '../stores/terminal'
import { useUIStore } from '../stores/ui'

export function TerminalView(): React.JSX.Element {
  const {
    tabs,
    activeTabId,
    addTab,
    closeTab,
    setActiveTab,
    renameTab,
    reorderTab,
    splitEnabled,
    toggleSplit,
    showFind,
    setShowFind,
    createAgentTab,
    zoomIn,
    zoomOut,
    resetZoom
  } = useTerminalStore()
  const activeView = useUIStore((s) => s.activeView)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isAgentTab = activeTab?.kind === 'agent'

  const handleClear = useCallback(() => {
    if (activeTabId && !isAgentTab) clearTerminal(activeTabId)
  }, [activeTabId, isAgentTab])

  const handleCloseOthers = useCallback((keepId: string) => {
    const { tabs: currentTabs } = useTerminalStore.getState()
    currentTabs.forEach((tab) => {
      if (tab.id !== keepId) closeTab(tab.id)
    })
  }, [closeTab])

  const handleCloseAll = useCallback(() => {
    const { tabs: currentTabs } = useTerminalStore.getState()
    // Keep at least one tab
    currentTabs.slice(1).forEach((tab) => closeTab(tab.id))
  }, [closeTab])

  // Keyboard shortcuts — capture phase so they fire before App.tsx global handler
  useEffect(() => {
    if (activeView !== 'terminal') return

    const handler = (e: KeyboardEvent): void => {
      // Cmd/Meta key shortcuts
      if (e.metaKey && !e.ctrlKey) {
        // Cmd+T — New tab
        if (e.key === 't') {
          e.preventDefault()
          e.stopPropagation()
          addTab()
          return
        }

        // Cmd+W — Close tab
        if (e.key === 'w') {
          e.preventDefault()
          e.stopPropagation()
          if (activeTabId) closeTab(activeTabId)
          return
        }

        // Cmd+F — Find
        if (e.key === 'f') {
          e.preventDefault()
          e.stopPropagation()
          const currentTab = tabs.find((t) => t.id === activeTabId)
          if (currentTab?.kind === 'shell') {
            setShowFind(!useTerminalStore.getState().showFind)
          }
          return
        }

        // Cmd+D — Split pane right
        if (e.key === 'd' && !e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          toggleSplit()
          return
        }

        // Cmd+Shift+D — Split pane down (future)
        if (e.key === 'D' && e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          // Reserved for vertical split in Phase 2
          return
        }

        // Cmd+Shift+[ — Previous tab
        if (e.key === '[' && e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          const currentIdx = tabs.findIndex((t) => t.id === activeTabId)
          if (currentIdx > 0) {
            setActiveTab(tabs[currentIdx - 1].id)
          }
          return
        }

        // Cmd+Shift+] — Next tab
        if (e.key === ']' && e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          const currentIdx = tabs.findIndex((t) => t.id === activeTabId)
          if (currentIdx < tabs.length - 1) {
            setActiveTab(tabs[currentIdx + 1].id)
          }
          return
        }

        // Cmd+= — Zoom in
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          e.stopPropagation()
          zoomIn()
          return
        }

        // Cmd+- — Zoom out
        if (e.key === '-') {
          e.preventDefault()
          e.stopPropagation()
          zoomOut()
          return
        }

        // Cmd+0 — Reset zoom
        if (e.key === '0') {
          e.preventDefault()
          e.stopPropagation()
          resetZoom()
          return
        }

        // Cmd+Shift+C — Copy all (placeholder for future implementation)
        if (e.key === 'C' && e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          // TODO: Implement copy all scrollback
          return
        }
      }

      // Ctrl+L — Clear terminal
      if (e.ctrlKey && e.key === 'l' && !e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        if (activeTabId) clearTerminal(activeTabId)
        return
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activeView, tabs, activeTabId, addTab, closeTab, setActiveTab, toggleSplit, setShowFind, zoomIn, zoomOut, resetZoom])

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
          onRenameTab={renameTab}
          onReorderTab={reorderTab}
          onCloseOthers={handleCloseOthers}
          onCloseAll={handleCloseAll}
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
