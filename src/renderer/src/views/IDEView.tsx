import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { PanelLeftOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useIDEStore } from '../stores/ide'
import { useTerminalStore } from '../stores/terminal'
import { useUIStore } from '../stores/ui'
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

export function IDEView(): React.JSX.Element {
  const reduced = useReducedMotion()
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
        }
        // Set watchDir FIRST so ideRootPath is ready before any readFile calls
        if (state.rootPath) await window.api.watchDir(state.rootPath)
        useIDEStore.setState({
          rootPath: state.rootPath ?? null,
          sidebarCollapsed: state.sidebarCollapsed ?? false,
          terminalCollapsed: state.terminalCollapsed ?? false,
          recentFolders: state.recentFolders ?? []
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
      setRootPath: s.setRootPath,
      openTab: s.openTab,
      closeTab: s.closeTab,
      setDirty: s.setDirty,
      setFocusedPanel: s.setFocusedPanel,
      toggleSidebar: s.toggleSidebar,
      toggleTerminal: s.toggleTerminal
    }))
  )

  const activeView = useUIStore((s) => s.activeView)
  const termAddTab = useTerminalStore((s) => s.addTab)
  const termCloseTab = useTerminalStore((s) => s.closeTab)
  const termSetActiveTab = useTerminalStore((s) => s.setActiveTab)
  const termToggleSplit = useTerminalStore((s) => s.toggleSplit)
  const termSetShowFind = useTerminalStore((s) => s.setShowFind)
  const termZoomIn = useTerminalStore((s) => s.zoomIn)
  const termZoomOut = useTerminalStore((s) => s.zoomOut)
  const termResetZoom = useTerminalStore((s) => s.resetZoom)

  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null
  const { confirmUnsaved, confirmProps } = useUnsavedDialog()

  useEffect(() => {
    if (!activeTab) return
    const { filePath } = activeTab
    if (fileContents[filePath] !== undefined) return
    window.api
      .readFile(filePath)
      .then((content) => setFileContents((prev) => ({ ...prev, [filePath]: content ?? '' })))
      .catch(() => setFileContents((prev) => ({ ...prev, [filePath]: '' })))
  }, [activeTab, fileContents])

  const handleSave = useCallback(async () => {
    if (!activeTab) return
    const content = fileContents[activeTab.filePath]
    if (content === undefined) return
    try {
      await window.api.writeFile(activeTab.filePath, content)
      setDirty(activeTab.id, false)
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [activeTab, fileContents, setDirty])

  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeTab) return
      setFileContents((prev) => ({ ...prev, [activeTab.filePath]: content }))
      setDirty(activeTab.id, true)
    },
    [activeTab, setDirty]
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
        if (e.key === 's' && focusedPanel === 'editor') {
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
    termResetZoom
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
                  <EditorPane
                    filePath={activeTab?.filePath ?? null}
                    content={activeTab ? (fileContents[activeTab.filePath] ?? null) : null}
                    language={activeTab?.language ?? 'plaintext'}
                    onContentChange={handleContentChange}
                    onSave={() => void handleSave()}
                  />
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
    </motion.div>
  )
}

export default IDEView
