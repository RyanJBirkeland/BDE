import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { PanelLeftOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useIDEStore } from '../stores/ide'
import { useIDEFileCache } from '../stores/ideFileCache'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { EditorPane } from '../components/ide/EditorPane'
import { EditorTabBar } from '../components/ide/EditorTabBar'
import { EditorBreadcrumb } from '../components/ide/EditorBreadcrumb'
import { EditorToolbar } from '../components/ide/EditorToolbar'
import { FileSidebar } from '../components/ide/FileSidebar'
import { TerminalPanel } from '../components/ide/TerminalPanel'
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

  useIDEStateRestoration()

  const {
    rootPath,
    openTabs,
    activeTabId,
    sidebarCollapsed,
    terminalCollapsed,
    focusedPanel,
    minimapEnabled,
    wordWrapEnabled,
    fontSize,
    setRootPath,
    openTab,
    closeTab,
    setDirty,
    setFocusedPanel,
    toggleSidebar,
    toggleTerminal
  } = useIDEStore(
    useShallow((s) => ({
      rootPath: s.rootPath,
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      sidebarCollapsed: s.sidebarCollapsed,
      terminalCollapsed: s.terminalCollapsed,
      focusedPanel: s.focusedPanel,
      minimapEnabled: s.minimapEnabled,
      wordWrapEnabled: s.wordWrapEnabled,
      fontSize: s.fontSize,
      setRootPath: s.setRootPath,
      openTab: s.openTab,
      closeTab: s.closeTab,
      setDirty: s.setDirty,
      setFocusedPanel: s.setFocusedPanel,
      toggleSidebar: s.toggleSidebar,
      toggleTerminal: s.toggleTerminal
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
  const { fileContents, fileLoadingStates } = fileCache

  const activeView = usePanelLayoutStore((s) => s.activeView)
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null
  const { confirmUnsaved, confirmProps } = useUnsavedDialog()
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)
  const sidebarPanelRef = usePanelRef()

  useEffect(() => {
    if (sidebarCollapsed) {
      sidebarPanelRef.current?.collapse()
    } else {
      sidebarPanelRef.current?.expand()
    }
  }, [sidebarCollapsed, sidebarPanelRef])

  const { handleSave, handleContentChange, handleCloseTab, handleOpenFolder, handleOpenFile } =
    useIDEFileOperations({
      activeTab,
      openTabs,
      fileCache,
      actions: { setRootPath, openTab, closeTab, setDirty, setFocusedPanel },
      confirmUnsaved
    })

  useIDEUnsavedGuard(openTabs)

  // Register IDE commands in command palette
  const handleNewTerminalTab = useCallback(() => {
    // Dispatch custom event for terminal to handle
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
    setShowQuickOpen
  })

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
      <motion.div
        className="ide-view"
        onClick={() => setFocusedPanel('editor')}
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <Group orientation="horizontal" style={{ flex: 1, height: '100%', minHeight: 0 }}>
          <Panel panelRef={sidebarPanelRef} defaultSize={20} minSize={10} collapsible>
            <FileSidebar onOpenFile={handleOpenFile} />
          </Panel>
          <Separator className="ide-separator ide-separator--h" />
          <Panel defaultSize={80} minSize={30}>
            <Group orientation="vertical" style={{ height: '100%' }}>
              <Panel defaultSize={terminalCollapsed ? 100 : 65} minSize={20}>
                <div
                  className="ide-editor-area"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusedPanel('editor')
                  }}
                >
                  {sidebarCollapsed && !activeTab && (
                    <button
                      className="ide-sidebar-toggle"
                      onClick={toggleSidebar}
                      aria-label="Open sidebar"
                    >
                      <PanelLeftOpen size={16} />
                    </button>
                  )}
                  <EditorTabBar onCloseTab={(id, dirty) => void handleCloseTab(id, dirty)} />
                  <EditorBreadcrumb />
                  <EditorToolbar />
                  <div className="ide-editor-content">
                    {/* IDE-9: Show loading indicator while file is being fetched */}
                    {activeTab && fileLoadingStates[activeTab.filePath] ? (
                      <div className="ide-file-loading">Loading...</div>
                    ) : (
                      <EditorPane
                        filePath={activeTab?.filePath ?? null}
                        content={activeTab ? (fileContents[activeTab.filePath] ?? null) : null}
                        language={activeTab?.language ?? 'plaintext'}
                        onContentChange={handleContentChange}
                        onSave={() => void handleSave()}
                        minimapEnabled={minimapEnabled}
                        wordWrapEnabled={wordWrapEnabled}
                        fontSize={fontSize}
                      />
                    )}
                  </div>
                </div>
              </Panel>
              {!terminalCollapsed && (
                <>
                  <Separator className="ide-separator ide-separator--v" />
                  <Panel defaultSize={35} minSize={15}>
                    <div
                      style={{ height: '100%' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setFocusedPanel('terminal')
                      }}
                    >
                      <TerminalPanel />
                    </div>
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
        </Group>
        <UnsavedDialogModal {...confirmProps} />

        {/* Quick Open Palette */}
        {showQuickOpen && rootPath && (
          <QuickOpenPalette
            rootPath={rootPath}
            onClose={() => setShowQuickOpen(false)}
            onSelectFile={handleOpenFile}
          />
        )}

        {/* Keyboard shortcuts help overlay */}
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
      </motion.div>
    </ErrorBoundary>
  )
}

export default IDEView
