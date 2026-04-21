/**
 * MemorySection — thin coordinator for agent memory UI.
 * Composes MemoryFileList, MemoryFileEditor, and MemorySearch.
 * Owns dirty-state gating before file switch and file creation flow.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../stores/toasts'
import './MemorySection.css'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import * as memoryService from '../../services/memory'
import { SettingsCard } from './SettingsCard'
import { useMemoryFiles } from './useMemoryFiles'
import { MemoryFileList } from './MemoryFileList'
import { MemoryFileEditor } from './MemoryFileEditor'

export function MemorySection(): React.JSX.Element {
  const {
    files,
    loadingFiles,
    activeFiles,
    loadFiles,
    saveFile: saveFileToService,
    createFile: createFileWithService,
    toggleActive
  } = useMemoryFiles()

  const [loadingContent, setLoadingContent] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [newFilePrompt, setNewFilePrompt] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<memoryService.MemorySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const { confirm, confirmProps } = useConfirm()

  const isDirty = content !== savedContent

  const openFile = useCallback(async (path: string) => {
    setLoadingContent(true)
    try {
      const text = await memoryService.readFile(path)
      setSelectedPath(path)
      setContent(text)
      setSavedContent(text)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open file')
    } finally {
      setLoadingContent(false)
    }
  }, [])

  /**
   * Attempt to switch to a new file, showing a confirmation if there are unsaved changes.
   */
  const handleSelectFile = useCallback(
    async (path: string) => {
      if (isDirty) {
        const ok = await confirm({
          title: 'Unsaved changes',
          message: 'You have unsaved changes. Switch files and discard them?',
          confirmLabel: 'Discard & switch',
          variant: 'danger'
        })
        if (!ok) return
      }
      await openFile(path)
    },
    [isDirty, confirm, openFile]
  )

  const saveFile = useCallback(async () => {
    if (!selectedPath) return
    await saveFileToService(selectedPath, content)
    setSavedContent(content)
  }, [selectedPath, content, saveFileToService])

  const discard = useCallback(() => {
    setContent(savedContent)
  }, [savedContent])

  const createFile = useCallback(async () => {
    const name = newFileName.trim()
    if (!name) return
    setCreating(true)
    try {
      await createFileWithService(name, async (path) => {
        setNewFilePrompt(false)
        setNewFileName('')
        await openFile(path)
      })
    } finally {
      setCreating(false)
    }
  }, [newFileName, createFileWithService, openFile])

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)

    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const { results } = await memoryService.search(query)
      setSearchResults(results)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to search memory files')
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults([])
  }, [])

  // Warn browser/Electron on unload when there are unsaved changes
  useEffect(() => {
    if (!isDirty) return
    function onBeforeUnload(e: BeforeUnloadEvent): void {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  const activeCount = Object.keys(activeFiles).length

  return (
    <SettingsCard title="Agent Memory" subtitle="Browse and edit agent memory files" noPadding>
      <div className="memory-view__content">
        <MemoryFileList
          files={files}
          loadingFiles={loadingFiles}
          selectedPath={selectedPath}
          activeFiles={activeFiles}
          searchQuery={searchQuery}
          searchResults={searchResults}
          isSearching={isSearching}
          onSelectFile={handleSelectFile}
          onSearch={handleSearch}
          onClearSearch={clearSearch}
          onLoadFiles={loadFiles}
          onToggleActive={toggleActive}
          onNewFileClick={() => setNewFilePrompt(true)}
          activeCount={activeCount}
          newFilePrompt={newFilePrompt}
          newFileName={newFileName}
          creating={creating}
          onNewFileNameChange={setNewFileName}
          onNewFileSubmit={createFile}
          onNewFileCancel={() => {
            setNewFilePrompt(false)
            setNewFileName('')
          }}
        />

        <MemoryFileEditor
          selectedPath={selectedPath}
          content={content}
          savedContent={savedContent}
          loadingContent={loadingContent}
          activeFiles={activeFiles}
          files={files}
          onContentChange={setContent}
          onSaveFile={saveFile}
          onDiscardChanges={discard}
          onToggleActive={toggleActive}
        />
      </div>
      <ConfirmModal {...confirmProps} />
    </SettingsCard>
  )
}
