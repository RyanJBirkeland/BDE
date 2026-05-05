import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type * as monaco from 'monaco-editor'
import { useShallow } from 'zustand/react/shallow'
import { useIDEStore } from '../stores/ide'
import { useIDEFileCache } from '../stores/ideFileCache'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { ActivityRail } from '../components/ide/ActivityRail'
import { IDESidebar } from '../components/ide/IDESidebar'
import { EditorColumn } from '../components/ide/EditorColumn'
import { InsightRail } from '../components/ide/InsightRail'
import { IDEStatusBar } from '../components/ide/IDEStatusBar'
import { IDEEmptyState } from '../components/ide/IDEEmptyState'
import { useUnsavedDialog, UnsavedDialogModal } from '../components/ide/UnsavedDialog'
import { QuickOpenPalette } from '../components/ide/QuickOpenPalette'
import { useIDEKeyboard } from '../hooks/useIDEKeyboard'
import { useIDEStateRestoration } from '../hooks/useIDEStateRestoration'
import { useIDEFileOperations } from '../hooks/useIDEFileOperations'
import { useIDEUnsavedGuard } from '../hooks/useIDEUnsavedGuard'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import './IDEView.css'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'

const IDE_SHORTCUTS = [
  { keys: '⌘1', desc: 'Files panel' },
  { keys: '⌘⇧F', desc: 'Search panel' },
  { keys: '⌘⇧G', desc: 'Source Control panel' },
  { keys: '⌘⇧O', desc: 'Outline panel' },
  { keys: '⌘⇧A', desc: 'Agents panel' },
  { keys: '⌘⌥I', desc: 'Toggle Insight Rail' },
  { keys: '⌘B', desc: 'Toggle sidebar' },
  { keys: '⌘J', desc: 'Toggle terminal' },
  { keys: '⌘O', desc: 'Open folder' },
  { keys: '⌘P', desc: 'Quick open file' },
  { keys: '⌘S', desc: 'Save file' },
  { keys: '⌘W', desc: 'Close tab' },
  { keys: '⌘T', desc: 'New terminal tab' },
  { keys: '⌘F', desc: 'Find in editor/terminal' },
  { keys: '⌘⇧D', desc: 'Split terminal' },
  { keys: '⌘⇧[/]', desc: 'Prev/next terminal tab' },
  { keys: '⌘+/-/0', desc: 'Terminal zoom' },
  { keys: '⌃L', desc: 'Clear terminal' },
  { keys: '⌘/', desc: 'Show this help' }
] as const

export function IDEView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useIDEStateRestoration()

  const {
    rootPath,
    openTabs,
    activeTabId,
    focusedPanel,
    uiState,
    setRootPath,
    openTab,
    closeTab,
    setDirty,
    setFocusedPanel,
    toggleSidebar,
    toggleTerminal,
    setActivity,
    setInsightRailOpen,
    setTerminalOpen,
    setSidebarOpen
  } = useIDEStore(
    useShallow((s) => ({
      rootPath: s.rootPath,
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      focusedPanel: s.focusedPanel,
      uiState: s.uiState,
      setRootPath: s.setRootPath,
      openTab: s.openTab,
      closeTab: s.closeTab,
      setDirty: s.setDirty,
      setFocusedPanel: s.setFocusedPanel,
      toggleSidebar: s.toggleSidebar,
      toggleTerminal: s.toggleTerminal,
      setActivity: s.setActivity,
      setInsightRailOpen: s.setInsightRailOpen,
      setTerminalOpen: s.setTerminalOpen,
      setSidebarOpen: s.setSidebarOpen
    }))
  )

  const fileCache = useIDEFileCache(
    useShallow((s) => ({
      fileContents: s.fileContents,
      fileLoadingStates: s.fileLoadingStates,
      setFileContent: s.setFileContent,
      setFileLoading: s.setFileLoading
    }))
  )

  const activeView = usePanelLayoutStore((s) => s.activeView)
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null
  const activeFilePath = activeTab?.filePath ?? null
  const { confirmUnsaved, confirmProps } = useUnsavedDialog()
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)

  const { handleSave, handleContentChange, handleCloseTab, handleOpenFolder, handleOpenFile } =
    useIDEFileOperations({
      activeTab,
      openTabs,
      fileCache,
      actions: { setRootPath, openTab, closeTab, setDirty, setFocusedPanel },
      confirmUnsaved
    })

  useIDEUnsavedGuard(openTabs)

  const handleNewTerminalTab = useCallback(() => {
    window.dispatchEvent(new CustomEvent('ide:new-terminal-tab'))
  }, [])

  useEffect(() => {
    const commands: Command[] = [
      {
        id: 'ide-open-folder',
        label: 'Open Folder',
        category: 'action',
        keywords: ['open', 'folder', 'directory', 'workspace'],
        action: () => void handleOpenFolder()
      },
      {
        id: 'ide-toggle-sidebar',
        label: 'Toggle Sidebar',
        category: 'panel',
        keywords: ['toggle', 'sidebar', 'explorer', 'files'],
        action: toggleSidebar
      },
      {
        id: 'ide-toggle-terminal',
        label: 'Toggle Terminal',
        category: 'panel',
        keywords: ['toggle', 'terminal', 'console', 'shell'],
        action: toggleTerminal
      },
      {
        id: 'ide-new-terminal-tab',
        label: 'New Terminal Tab',
        category: 'action',
        keywords: ['new', 'terminal', 'tab', 'create'],
        action: handleNewTerminalTab
      }
    ]

    registerCommands(commands)

    return () => {
      unregisterCommands(commands.map((c) => c.id))
    }
  }, [
    handleOpenFolder,
    toggleSidebar,
    toggleTerminal,
    handleNewTerminalTab,
    registerCommands,
    unregisterCommands
  ])

  const toggleInsightRail = useCallback(
    () => setInsightRailOpen(!uiState.insightRailOpen),
    [setInsightRailOpen, uiState.insightRailOpen]
  )

  useIDEKeyboard({
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
  })

  const currentActivity = uiState.activity
  const currentSidebarOpen = uiState.sidebarOpen

  const handleActivityChange = useCallback(
    (mode: typeof currentActivity) => {
      // Re-clicking the active mode collapses the sidebar; clicking a new mode
      // ensures the sidebar is open so the user sees the panel they requested.
      if (mode === currentActivity) {
        setSidebarOpen(!currentSidebarOpen)
        return
      }
      setActivity(mode)
      setSidebarOpen(true)
    },
    [currentActivity, currentSidebarOpen, setActivity, setSidebarOpen]
  )

  const handleAgentClick = useCallback((_agentId: string) => {
    // TODO: navigate to Agents view + select this agent.
  }, [])

  const handleNewFile = useCallback(() => {
    handleOpenFile('')
  }, [handleOpenFile])

  if (!rootPath) {
    return (
      <>
        <IDEEmptyState onOpenFolder={() => void handleOpenFolder()} />
        <UnsavedDialogModal {...confirmProps} />
      </>
    )
  }

  return (
    <ErrorBoundary name="IDEView">
      <motion.main
        className="ide-view"
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          <ActivityRail
            activity={uiState.activity}
            onChange={handleActivityChange}
            insightOpen={uiState.insightRailOpen}
            onToggleInsight={toggleInsightRail}
          />
          <IDESidebar
            activity={uiState.activity}
            activeFilePath={activeFilePath}
            onOpenFile={handleOpenFile}
            open={uiState.sidebarOpen}
            rootPath={rootPath}
            editorRef={editorRef}
            onAgentClick={handleAgentClick}
          />
          <EditorColumn
            terminalOpen={uiState.terminalOpen}
            insightOpen={uiState.insightRailOpen}
            onToggleTerminal={() => setTerminalOpen(!uiState.terminalOpen)}
            onToggleInsight={toggleInsightRail}
            onCloseTab={handleCloseTab}
            onNewFile={handleNewFile}
            editorRef={editorRef}
            onContentChange={handleContentChange}
            onSave={() => void handleSave()}
          />
          {uiState.insightRailOpen && (
            <InsightRail
              activeFilePath={activeFilePath}
              editorRef={editorRef}
              onClose={() => setInsightRailOpen(false)}
              rootPath={rootPath}
            />
          )}
        </div>

        <IDEStatusBar editorRef={editorRef} />

        <UnsavedDialogModal {...confirmProps} />

        {showQuickOpen && rootPath && (
          <QuickOpenPalette
            rootPath={rootPath}
            onClose={() => setShowQuickOpen(false)}
            onSelectFile={handleOpenFile}
          />
        )}

        {showShortcuts && (
          <div
            className="ide-shortcuts-overlay"
            onClick={() => setShowShortcuts(false)}
            role="dialog"
            aria-label="IDE Keyboard Shortcuts"
          >
            <div className="ide-shortcuts-panel" onClick={(e) => e.stopPropagation()}>
              <div className="ide-shortcuts-panel__title">Keyboard Shortcuts</div>
              <div className="ide-shortcuts-panel__grid">
                {IDE_SHORTCUTS.map(({ keys, desc }) => (
                  <div key={keys} className="ide-shortcuts-panel__row">
                    <kbd className="ide-shortcuts-panel__key">{keys}</kbd>
                    <span className="ide-shortcuts-panel__desc">{desc}</span>
                  </div>
                ))}
              </div>
              <div className="ide-shortcuts-panel__hint">Press ⌘/ or Esc to close</div>
            </div>
          </div>
        )}
      </motion.main>
    </ErrorBoundary>
  )
}

export default IDEView
