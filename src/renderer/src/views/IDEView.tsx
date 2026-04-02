import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { PanelLeftOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useIDEStore } from '../stores/ide'
import { useTerminalStore } from '../stores/terminal'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { EditorPane } from '../components/ide/EditorPane'
import { EditorTabBar } from '../components/ide/EditorTabBar'
import { FileSidebar } from '../components/ide/FileSidebar'
import { TerminalPanel } from '../components/ide/TerminalPanel'
import { IDEEmptyState } from '../components/ide/IDEEmptyState'
import { useUnsavedDialog, UnsavedDialogModal } from '../components/ide/UnsavedDialog'
import { clearTerminal } from '../components/terminal/TerminalPane'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { toast } from '../stores/toasts'
import '../assets/ide-neon.css'

const IDE_SHORTCUTS = [
  { keys: '⌘B', desc: 'Toggle sidebar' },
  { keys: '⌘J', desc: 'Toggle terminal' },
  { keys: '⌘O', desc: 'Open folder' },
  { keys: '⌘S', desc: 'Save file' },
  { keys: '⌘W', desc: 'Close tab' },
  { keys: '⌘T', desc: 'New terminal tab' },
  { keys: '⌘F', desc: 'Find in terminal' },
  { keys: '⌘⇧D', desc: 'Split terminal' },
  { keys: '⌘⇧[/]', desc: 'Prev/next terminal tab' },
  { keys: '⌘+/-/0', desc: 'Terminal zoom' },
  { keys: '⌃L', desc: 'Clear terminal' },
  { keys: '⌘/', desc: 'Show this help' }
] as const

export function IDEView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const [showShortcuts, setShowShortcuts] = useState(false)
  useEffect(() => {
    const restore = async (): Promise<void> => {
      try {
        const saved = await window.api.settings.getJson('ide.state')
        if (!saved || typeof saved !== 'object') return
        const state = saved as {
          rootPath?: string
          openTabs?: { filePath: string }[]
          activeFilePath?: string
          sidebarCollapsed?: boolean
          terminalCollapsed?: boolean
          recentFolders?: string[]
          expandedDirs?: Record<string, boolean> // IDE-11
        }
        // Set watchDir FIRST so ideRootPath is ready before any readFile calls
        if (state.rootPath) await window.api.watchDir(state.rootPath)
        useIDEStore.setState({
          rootPath: state.rootPath ?? null,
          sidebarCollapsed: state.sidebarCollapsed ?? false,
          terminalCollapsed: state.terminalCollapsed ?? false,
          recentFolders: state.recentFolders ?? [],
          expandedDirs: state.expandedDirs ?? {} // IDE-11: Restore expanded directories
        })
        if (state.openTabs) {
          for (const tab of state.openTabs) {
            useIDEStore.getState().openTab(tab.filePath)
          }
          if (state.activeFilePath) {
            const match = useIDEStore
              .getState()
              .openTabs.find((t) => t.filePath === state.activeFilePath)
            if (match) useIDEStore.getState().setActiveTab(match.id)
          }
        }
      } catch (err) {
        console.error('Failed to restore IDE state:', err)
      }
    }
    void restore()
  }, [])

  const {
    rootPath,
    openTabs,
    activeTabId,
    sidebarCollapsed,
    terminalCollapsed,
    focusedPanel,
    fileContents,
    fileLoadingStates,
    setRootPath,
    openTab,
    closeTab,
    setDirty,
    setFocusedPanel,
    toggleSidebar,
    toggleTerminal,
    setFileContent,
    setFileLoading
  } = useIDEStore(
    useShallow((s) => ({
      rootPath: s.rootPath,
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      sidebarCollapsed: s.sidebarCollapsed,
      terminalCollapsed: s.terminalCollapsed,
      focusedPanel: s.focusedPanel,
      fileContents: s.fileContents, // IDE-5
      fileLoadingStates: s.fileLoadingStates, // IDE-9
      setRootPath: s.setRootPath,
      openTab: s.openTab,
      closeTab: s.closeTab,
      setDirty: s.setDirty,
      setFocusedPanel: s.setFocusedPanel,
      toggleSidebar: s.toggleSidebar,
      toggleTerminal: s.toggleTerminal,
      setFileContent: s.setFileContent, // IDE-5
      setFileLoading: s.setFileLoading // IDE-9
    }))
  )

  const activeView = usePanelLayoutStore((s) => s.activeView)
  const termAddTab = useTerminalStore((s) => s.addTab)
  const termCloseTab = useTerminalStore((s) => s.closeTab)
  const termSetActiveTab = useTerminalStore((s) => s.setActiveTab)
  const termToggleSplit = useTerminalStore((s) => s.toggleSplit)
  const termSetShowFind = useTerminalStore((s) => s.setShowFind)
  const termZoomIn = useTerminalStore((s) => s.zoomIn)
  const termZoomOut = useTerminalStore((s) => s.zoomOut)
  const termResetZoom = useTerminalStore((s) => s.resetZoom)

  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null
  const { confirmUnsaved, confirmProps } = useUnsavedDialog()
  const savingPaths = useRef(new Set<string>())

  // IDE-5, IDE-7, IDE-8, IDE-9: Load file content from store with proper error handling and loading states
  useEffect(() => {
    if (!activeTab) return
    const { filePath } = activeTab
    if (fileContents[filePath] !== undefined) return
    if (fileLoadingStates[filePath]) return // Already loading

    setFileLoading(filePath, true)
    window.api
      .readFile(filePath)
      .then((content) => {
        setFileContent(filePath, content ?? '')
        setFileLoading(filePath, false)
      })
      .catch((err) => {
        setFileLoading(filePath, false)
        toast.error(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`)
        setFileContent(filePath, '') // Set empty content to prevent retry loop
      })
  }, [activeTab, fileContents, fileLoadingStates, setFileContent, setFileLoading])

  // IDE-7: Save is async, preventing race conditions on rapid tab switches
  const handleSave = useCallback(async () => {
    if (!activeTab) return
    const content = fileContents[activeTab.filePath]
    if (content === undefined) return
    const { filePath, id } = activeTab
    if (savingPaths.current.has(filePath)) return // Already saving this file
    savingPaths.current.add(filePath)
    try {
      await window.api.writeFile(filePath, content)
      setDirty(id, false)
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      savingPaths.current.delete(filePath)
    }
  }, [activeTab, fileContents, setDirty])

  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeTab) return
      setFileContent(activeTab.filePath, content)
      setDirty(activeTab.id, true)
    },
    [activeTab, setDirty, setFileContent]
  )

  const handleCloseTab = useCallback(
    async (tabId: string, isDirty: boolean) => {
      if (isDirty) {
        const tab = openTabs.find((t) => t.id === tabId)
        if (tab) {
          const discard = await confirmUnsaved(tab.displayName)
          if (!discard) return
        }
      }
      closeTab(tabId)
    },
    [openTabs, confirmUnsaved, closeTab]
  )

  const handleOpenFolder = useCallback(async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) {
      setRootPath(dir)
      await window.api.watchDir(dir)
    }
  }, [setRootPath])

  const handleOpenFile = useCallback(
    (filePath: string) => {
      openTab(filePath)
      setFocusedPanel('editor')
    },
    [openTab, setFocusedPanel]
  )

  // IDE-10: Add beforeunload guard for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      const hasDirtyTabs = openTabs.some((t) => t.isDirty)
      if (hasDirtyTabs) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [openTabs])

  useEffect(() => {
    if (activeView !== 'ide') return
    const handler = (e: KeyboardEvent): void => {
      if (e.metaKey && !e.ctrlKey) {
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
            if (idx > 0) termSetActiveTab(tabs[idx - 1].id)
            return
          }
          if (e.key === ']' && e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            const { tabs, activeTabId: tid } = useTerminalStore.getState()
            const idx = tabs.findIndex((t) => t.id === tid)
            if (idx < tabs.length - 1) termSetActiveTab(tabs[idx + 1].id)
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
    showShortcuts
  ])

  if (!rootPath) {
    return (
      <>
        <IDEEmptyState onOpenFolder={() => void handleOpenFolder()} />
        <UnsavedDialogModal {...confirmProps} />
      </>
    )
  }

  return (
    <motion.div
      className="ide-view"
      onClick={() => setFocusedPanel('editor')}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <Group orientation="horizontal" style={{ flex: 1, height: '100%', minHeight: 0 }}>
        {!sidebarCollapsed && (
          <>
            <Panel defaultSize={20} minSize={10}>
              <FileSidebar onOpenFile={handleOpenFile} />
            </Panel>
            <Separator className="ide-separator ide-separator--h" />
          </>
        )}
        <Panel defaultSize={sidebarCollapsed ? 100 : 80} minSize={30}>
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
                  <button className="ide-sidebar-toggle" onClick={toggleSidebar}>
                    <PanelLeftOpen size={16} />
                  </button>
                )}
                <EditorTabBar onCloseTab={(id, dirty) => void handleCloseTab(id, dirty)} />
                <div className="ide-editor-content">
                  {/* IDE-9: Show loading indicator while file is being fetched */}
                  {activeTab && fileLoadingStates[activeTab.filePath] ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: 'var(--bde-text-dim)',
                        fontSize: 'var(--bde-size-sm)'
                      }}
                    >
                      Loading...
                    </div>
                  ) : (
                    <EditorPane
                      filePath={activeTab?.filePath ?? null}
                      content={activeTab ? (fileContents[activeTab.filePath] ?? null) : null}
                      language={activeTab?.language ?? 'plaintext'}
                      onContentChange={handleContentChange}
                      onSave={() => void handleSave()}
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
  )
}

export default IDEView
