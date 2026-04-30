import { useCallback, useEffect, useRef } from 'react'
import { toast } from '../stores/toasts'

interface IDETab {
  id: string
  filePath: string
  displayName: string
  isDirty: boolean
}

interface FileCache {
  fileContents: Record<string, string>
  fileLoadingStates: Record<string, boolean>
  setFileContent: (path: string, content: string) => void
  setFileLoading: (path: string, loading: boolean) => void
}

interface IDEActions {
  setRootPath: (path: string) => void
  openTab: (path: string) => void
  closeTab: (id: string) => void
  setDirty: (id: string, dirty: boolean) => void
  setFocusedPanel: (panel: 'editor' | 'terminal') => void
}

interface UseIDEFileOperationsParams {
  activeTab: IDETab | null
  openTabs: IDETab[]
  fileCache: FileCache
  actions: IDEActions
  confirmUnsaved: (displayName: string) => Promise<boolean>
}

interface UseIDEFileOperationsResult {
  handleSave: () => Promise<void>
  handleContentChange: (content: string) => void
  handleCloseTab: (tabId: string, isDirty: boolean) => Promise<void>
  handleOpenFolder: () => Promise<void>
  handleOpenFile: (filePath: string) => void
}

export function useIDEFileOperations({
  activeTab,
  openTabs,
  fileCache,
  actions,
  confirmUnsaved
}: UseIDEFileOperationsParams): UseIDEFileOperationsResult {
  const { fileContents, fileLoadingStates, setFileContent, setFileLoading } = fileCache
  const { setRootPath, openTab, closeTab, setDirty, setFocusedPanel } = actions
  const savingPaths = useRef(new Set<string>())

  // Load file content when the active tab changes
  useEffect(() => {
    if (!activeTab) return
    const { filePath } = activeTab
    if (fileContents[filePath] !== undefined) return
    if (fileLoadingStates[filePath]) return // Already loading

    setFileLoading(filePath, true)
    window.api.fs
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

  // Save is async to prevent race conditions on rapid tab switches
  const handleSave = useCallback(async () => {
    if (!activeTab) return
    const content = fileContents[activeTab.filePath]
    if (content === undefined) return
    const { filePath, id } = activeTab
    if (savingPaths.current.has(filePath)) return // Already saving this file
    savingPaths.current.add(filePath)
    try {
      await window.api.fs.writeFile(filePath, content)
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
    const dir = await window.api.fs.openDirDialog()
    if (dir) {
      setRootPath(dir)
      await window.api.fs.watchDir(dir)
    }
  }, [setRootPath])

  const handleOpenFile = useCallback(
    (filePath: string) => {
      openTab(filePath)
      setFocusedPanel('editor')
    },
    [openTab, setFocusedPanel]
  )

  return { handleSave, handleContentChange, handleCloseTab, handleOpenFolder, handleOpenFile }
}
