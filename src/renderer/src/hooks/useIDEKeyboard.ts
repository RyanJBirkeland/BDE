import { useEffect } from 'react'
import { useTerminalStore } from '../stores/terminal'
import type { IDEActivity } from '../stores/ide'
import { clearTerminal } from '../components/terminal/TerminalPane'

interface UseIDEKeyboardParams {
  activeView: string
  focusedPanel: 'editor' | 'terminal'
  activeTabId: string | null
  openTabs: Array<{ id: string; isDirty: boolean }>
  showShortcuts: boolean
  toggleSidebar: () => void
  toggleTerminal: () => void
  handleOpenFolder: () => Promise<void>
  handleSave: () => Promise<void>
  handleCloseTab: (tabId: string, isDirty: boolean) => Promise<void>
  setShowShortcuts: (show: boolean | ((prev: boolean) => boolean)) => void
  setShowQuickOpen: (show: boolean | ((prev: boolean) => boolean)) => void
  // V2 IDE: activity rail mode switching + insight rail toggle.
  setActivity?: (mode: IDEActivity) => void
  setSidebarOpen?: (open: boolean) => void
  toggleInsightRail?: () => void
}

export function useIDEKeyboard({
  activeView,
  focusedPanel,
  activeTabId,
  openTabs,
  showShortcuts,
  toggleSidebar,
  toggleTerminal,
  handleOpenFolder,
  handleSave,
  handleCloseTab,
  setShowShortcuts,
  setShowQuickOpen,
  setActivity,
  setSidebarOpen,
  toggleInsightRail
}: UseIDEKeyboardParams): void {
  const termAddTab = useTerminalStore((s) => s.addTab)
  const termCloseTab = useTerminalStore((s) => s.closeTab)
  const termSetActiveTab = useTerminalStore((s) => s.setActiveTab)
  const termToggleSplit = useTerminalStore((s) => s.toggleSplit)
  const termSetShowFind = useTerminalStore((s) => s.setShowFind)
  const termZoomIn = useTerminalStore((s) => s.zoomIn)
  const termZoomOut = useTerminalStore((s) => s.zoomOut)
  const termResetZoom = useTerminalStore((s) => s.resetZoom)

  useEffect(() => {
    if (activeView !== 'ide') return
    const handler = (e: KeyboardEvent): void => {
      if (e.metaKey && !e.ctrlKey) {
        // V2 activity rail mode switching (⌘⇧F/G/O/A) + ⌘1 files focus.
        // Note: ⌘1 also resolves to "switch to Dashboard view" at the app shell;
        // since this handler is gated on activeView==='ide' it will only fire
        // when the user is already in the IDE, so the global handler wins
        // when navigating away.
        if (e.shiftKey && setActivity) {
          if (e.key === 'F' || e.key === 'f') {
            e.preventDefault()
            e.stopPropagation()
            setActivity('search')
            setSidebarOpen?.(true)
            return
          }
          if (e.key === 'G' || e.key === 'g') {
            e.preventDefault()
            e.stopPropagation()
            setActivity('scm')
            setSidebarOpen?.(true)
            return
          }
          if (e.key === 'O' || e.key === 'o') {
            e.preventDefault()
            e.stopPropagation()
            setActivity('outline')
            setSidebarOpen?.(true)
            return
          }
          if (e.key === 'A' || e.key === 'a') {
            e.preventDefault()
            e.stopPropagation()
            setActivity('agents')
            setSidebarOpen?.(true)
            return
          }
        }
        if (e.altKey && (e.key === 'i' || e.key === 'I' || e.key === '∆') && toggleInsightRail) {
          e.preventDefault()
          e.stopPropagation()
          toggleInsightRail()
          return
        }
        if (e.key === '1' && setActivity) {
          e.preventDefault()
          e.stopPropagation()
          setActivity('files')
          setSidebarOpen?.(true)
          return
        }
        if (e.key === 'b') {
          e.preventDefault()
          e.stopPropagation()
          toggleSidebar()
          return
        }
        if (e.key === 'j') {
          e.preventDefault()
          e.stopPropagation()
          toggleTerminal()
          return
        }
        if (e.key === 'o') {
          e.preventDefault()
          e.stopPropagation()
          void handleOpenFolder()
          return
        }
        if (e.key === 'p') {
          e.preventDefault()
          e.stopPropagation()
          setShowQuickOpen(true)
          return
        }
        // IDE-12: Allow Cmd+S to work regardless of focused panel if there's an active tab
        if (e.key === 's' && activeTabId) {
          e.preventDefault()
          e.stopPropagation()
          void handleSave()
          return
        }
        if (e.key === 'w') {
          if (focusedPanel === 'editor' && activeTabId) {
            e.preventDefault()
            e.stopPropagation()
            const tab = openTabs.find((t) => t.id === activeTabId)
            void handleCloseTab(activeTabId, tab?.isDirty ?? false)
            return
          }
          if (focusedPanel === 'terminal') {
            e.preventDefault()
            e.stopPropagation()
            const { activeTabId: tid } = useTerminalStore.getState()
            if (tid) termCloseTab(tid)
            return
          }
        }
        if (focusedPanel === 'terminal') {
          if (e.key === 't') {
            e.preventDefault()
            e.stopPropagation()
            termAddTab()
            return
          }
          if (e.key === 'f') {
            e.preventDefault()
            e.stopPropagation()
            const { tabs, activeTabId: tid } = useTerminalStore.getState()
            const tab = tabs.find((t) => t.id === tid)
            if (tab?.kind === 'shell') termSetShowFind(!useTerminalStore.getState().showFind)
            return
          }
          if (e.key === 'd' && !e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            termToggleSplit()
            return
          }
          if (e.key === '[' && e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            const { tabs, activeTabId: tid } = useTerminalStore.getState()
            const idx = tabs.findIndex((t) => t.id === tid)
            const prevTab = tabs[idx - 1]
            if (idx > 0 && prevTab) termSetActiveTab(prevTab.id)
            return
          }
          if (e.key === ']' && e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            const { tabs, activeTabId: tid } = useTerminalStore.getState()
            const idx = tabs.findIndex((t) => t.id === tid)
            const nextTab = tabs[idx + 1]
            if (idx < tabs.length - 1 && nextTab) termSetActiveTab(nextTab.id)
            return
          }
          if (e.key === '=' || e.key === '+') {
            e.preventDefault()
            e.stopPropagation()
            termZoomIn()
            return
          }
          if (e.key === '-') {
            e.preventDefault()
            e.stopPropagation()
            termZoomOut()
            return
          }
          if (e.key === '0') {
            e.preventDefault()
            e.stopPropagation()
            termResetZoom()
            return
          }
        }
      }
      if (e.metaKey && e.key === '/' && !e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        setShowShortcuts((v) => !v)
        return
      }
      if (e.key === 'Escape' && showShortcuts) {
        e.preventDefault()
        setShowShortcuts(false)
        return
      }
      if (e.ctrlKey && e.key === 'l' && !e.metaKey && focusedPanel === 'terminal') {
        e.preventDefault()
        e.stopPropagation()
        const { activeTabId: tid } = useTerminalStore.getState()
        if (tid) clearTerminal(tid)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [
    activeView,
    focusedPanel,
    activeTabId,
    openTabs,
    toggleSidebar,
    toggleTerminal,
    handleOpenFolder,
    handleSave,
    handleCloseTab,
    termAddTab,
    termCloseTab,
    termSetActiveTab,
    termToggleSplit,
    termSetShowFind,
    termZoomIn,
    termZoomOut,
    termResetZoom,
    showShortcuts,
    setShowShortcuts,
    setShowQuickOpen,
    setActivity,
    setSidebarOpen,
    toggleInsightRail
  ])
}
