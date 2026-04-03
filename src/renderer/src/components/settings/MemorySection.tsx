/**
 * MemorySection — file browser and editor for agent memory.
 * Lists memory files from ~/.bde/memory/ via IPC
 * (memory:listFiles, memory:readFile, memory:writeFile). Groups files
 * into pinned (MEMORY.md), daily logs, projects, and other. Keyboard-navigable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, FileText, Search, X } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import * as memoryService from '../../services/memory'
import { SettingsCard } from './SettingsCard'

interface MemoryFile {
  path: string
  name: string
  size: number
  modifiedAt: number
}

interface FileGroup {
  label: string
  files: MemoryFile[]
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)}KB`
  return `${(kb / 1024).toFixed(1)}MB`
}

function groupFiles(files: MemoryFile[]): { pinned: MemoryFile | null; groups: FileGroup[] } {
  let pinned: MemoryFile | null = null
  const dateFiles: MemoryFile[] = []
  const projectFiles: MemoryFile[] = []
  const otherFiles: MemoryFile[] = []

  for (const f of files) {
    if (f.path === 'MEMORY.md') {
      pinned = f
    } else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f.name)) {
      dateFiles.push(f)
    } else if (f.path.startsWith('projects/')) {
      projectFiles.push(f)
    } else {
      otherFiles.push(f)
    }
  }

  const groups: FileGroup[] = []
  if (dateFiles.length > 0) groups.push({ label: 'Daily Logs', files: dateFiles })
  if (projectFiles.length > 0) groups.push({ label: 'Projects', files: projectFiles })
  if (otherFiles.length > 0) groups.push({ label: 'Other', files: otherFiles })

  return { pinned, groups }
}

export function MemorySection(): React.JSX.Element {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
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
  const [activeFiles, setActiveFiles] = useState<Record<string, boolean>>({})
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const { confirm, confirmProps } = useConfirm()

  const isDirty = content !== savedContent

  const loadFiles = useCallback(async () => {
    try {
      const result = await memoryService.listFiles()
      setFiles(result)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load memory files')
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  const loadActiveFiles = useCallback(async () => {
    try {
      const result = await memoryService.getActiveFiles()
      setActiveFiles(result)
    } catch {
      // Silently fall back — active state is non-critical
    }
  }, [])

  useEffect(() => {
    loadFiles()
    loadActiveFiles()
  }, [loadFiles, loadActiveFiles])

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
    try {
      await memoryService.writeFile(selectedPath, content)
      setSavedContent(content)
      toast.success('File saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save file')
    }
  }, [selectedPath, content])

  const discard = useCallback(() => {
    setContent(savedContent)
  }, [savedContent])

  const createFile = useCallback(async () => {
    const name = newFileName.trim()
    if (!name) return
    const path = name.endsWith('.md') ? name : `${name}.md`
    setCreating(true)
    try {
      await memoryService.writeFile(path, '')
      setNewFilePrompt(false)
      setNewFileName('')
      await loadFiles()
      await openFile(path)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create file')
    } finally {
      setCreating(false)
    }
  }, [newFileName, loadFiles, openFile])

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)

    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const results = await memoryService.search(query)
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

  const toggleActive = useCallback(
    async (path: string) => {
      const newActive = !activeFiles[path]
      try {
        const updated = await memoryService.setFileActive(path, newActive)
        setActiveFiles(updated)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to toggle')
      }
    },
    [activeFiles]
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // Only intercept Cmd+S when the memory editor textarea is focused
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (document.activeElement === editorRef.current) {
          e.preventDefault()
          saveFile()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveFile])

  // Warn browser/Electron on unload when there are unsaved changes
  useEffect(() => {
    if (!isDirty) return
    function onBeforeUnload(e: BeforeUnloadEvent): void {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  // Build flat file list for keyboard nav
  const { pinned, groups } = groupFiles(files)
  const flatFiles = useMemo(() => {
    const list: MemoryFile[] = []
    if (pinned) list.push(pinned)
    for (const g of groups) list.push(...g.files)
    return list
  }, [pinned, groups])

  const [focusIndex, setFocusIndex] = useState(-1)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const activeView = usePanelLayoutStore((s) => s.activeView)

  useEffect(() => {
    if (activeView !== 'settings') return
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIndex((prev) => {
          const max = flatFiles.length - 1
          if (max < 0) return -1
          if (e.key === 'ArrowDown') return prev < max ? prev + 1 : 0
          return prev > 0 ? prev - 1 : max
        })
      }

      if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < flatFiles.length) {
        e.preventDefault()
        handleSelectFile(flatFiles[focusIndex].path)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView, focusIndex, flatFiles, handleSelectFile])

  // Scroll focused file into view
  useEffect(() => {
    if (focusIndex < 0) return
    const el = sidebarRef.current?.querySelector(
      `[data-memory-index="${focusIndex}"]`
    ) as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  const activeCount = Object.keys(activeFiles).length
  const activeTotalBytes = useMemo(
    () => files.filter((f) => activeFiles[f.path]).reduce((sum, f) => sum + f.size, 0),
    [files, activeFiles]
  )

  return (
    <SettingsCard title="Agent Memory" subtitle="Browse and edit agent memory files" noPadding>
      <div className="memory-view__content">
        <div className="memory-sidebar">
          <div className="memory-sidebar__header">
            <span className="memory-sidebar__title">Files</span>
            <span className="memory-sidebar__count bde-count-badge">{files.length}</span>
            <div className="memory-sidebar__actions">
              <Button
                variant="icon"
                size="sm"
                onClick={() => setNewFilePrompt(true)}
                title="New file"
                aria-label="New file"
              >
                +
              </Button>
              <Button
                variant="icon"
                size="sm"
                onClick={loadFiles}
                title="Refresh"
                aria-label="Refresh"
              >
                &#x21bb;
              </Button>
            </div>
          </div>

          {activeCount > 0 && (
            <div className="memory-sidebar__active-summary">
              {activeCount} file{activeCount !== 1 ? 's' : ''} active for agents
            </div>
          )}

          {newFilePrompt && (
            <div className="memory-sidebar__new-file">
              <input
                className="memory-sidebar__new-input"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createFile()
                  if (e.key === 'Escape') {
                    setNewFilePrompt(false)
                    setNewFileName('')
                  }
                }}
                placeholder="filename.md"
                disabled={creating}
                autoFocus
              />
            </div>
          )}

          <div className="memory-sidebar__search">
            <div className="memory-sidebar__search-input-wrapper">
              <Search size={16} className="memory-sidebar__search-icon" />
              <input
                className="memory-sidebar__search-input"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search memory files..."
              />
              {searchQuery && (
                <button
                  className="memory-sidebar__search-clear"
                  onClick={clearSearch}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="memory-sidebar__list" ref={sidebarRef}>
            {searchQuery ? (
              <>
                {isSearching ? (
                  <div className="memory-sidebar__loading">
                    <div className="bde-skeleton memory-sidebar__skeleton" />
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="memory-search-results">
                    {searchResults.map((result) => (
                      <button
                        key={result.path}
                        className={`memory-search-result ${selectedPath === result.path ? 'memory-search-result--active' : ''}`}
                        onClick={() => handleSelectFile(result.path)}
                      >
                        <div className="memory-search-result__header">
                          <span className="memory-search-result__path">{result.path}</span>
                          <span className="memory-search-result__count">
                            {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                          </span>
                        </div>
                        <div className="memory-search-result__matches">
                          {result.matches.slice(0, 2).map((match, idx) => (
                            <div key={idx} className="memory-search-result__match">
                              <span className="memory-search-result__line">{match.line}:</span>
                              <span className="memory-search-result__content">
                                {match.content}
                              </span>
                            </div>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Search size={24} />}
                    title="No matches found"
                    description={`No files match "${searchQuery}"`}
                  />
                )}
              </>
            ) : (
              <>
                {pinned && (
                  <div
                    className={`memory-file ${selectedPath === pinned.path ? 'memory-file--active' : ''} ${focusIndex === 0 ? 'memory-file--focused' : ''}`}
                    data-memory-index={0}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectFile(pinned.path)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSelectFile(pinned.path)
                    }}
                  >
                    <div className="memory-file__info">
                      <span className="memory-file__name">
                        <span className="memory-file__pin">{'\uD83D\uDCCC'}</span> {pinned.name}
                      </span>
                      <span className="memory-file__meta">
                        {formatRelativeTime(pinned.modifiedAt)} &middot;{' '}
                        {formatSize(pinned.size)}
                      </span>
                    </div>
                    <button
                      className={`memory-file__toggle ${activeFiles[pinned.path] ? 'memory-file__toggle--active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleActive(pinned.path)
                      }}
                      title={
                        activeFiles[pinned.path]
                          ? 'Included in agent prompts'
                          : 'Not included in agent prompts'
                      }
                      aria-label={
                        activeFiles[pinned.path]
                          ? 'Remove from agent knowledge'
                          : 'Add to agent knowledge'
                      }
                    >
                      <Brain size={14} />
                    </button>
                  </div>
                )}

                {groups.map((group) => (
                  <div key={group.label} className="memory-group">
                    <div className="memory-group__label">{group.label}</div>
                    {group.files.map((f) => {
                      const idx = flatFiles.indexOf(f)
                      return (
                        <div
                          key={f.path}
                          className={`memory-file ${selectedPath === f.path ? 'memory-file--active' : ''} ${focusIndex === idx ? 'memory-file--focused' : ''}`}
                          data-memory-index={idx}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSelectFile(f.path)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') handleSelectFile(f.path)
                          }}
                        >
                          <div className="memory-file__info">
                            <span className="memory-file__name">{f.name}</span>
                            <span className="memory-file__meta">
                              {formatRelativeTime(f.modifiedAt)} &middot; {formatSize(f.size)}
                            </span>
                          </div>
                          <button
                            className={`memory-file__toggle ${activeFiles[f.path] ? 'memory-file__toggle--active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleActive(f.path)
                            }}
                            title={
                              activeFiles[f.path]
                                ? 'Included in agent prompts'
                                : 'Not included in agent prompts'
                            }
                            aria-label={
                              activeFiles[f.path]
                                ? 'Remove from agent knowledge'
                                : 'Add to agent knowledge'
                            }
                          >
                            <Brain size={14} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}

                {loadingFiles && files.length === 0 && (
                  <div className="memory-sidebar__loading">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="bde-skeleton memory-sidebar__skeleton" />
                    ))}
                  </div>
                )}
                {!loadingFiles && files.length === 0 && (
                  <EmptyState
                    icon={<FileText size={24} />}
                    title="No memory files"
                    description="Create a file to start taking notes"
                    action={{ label: 'New File', onClick: () => setNewFilePrompt(true) }}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <div className="memory-editor">
          {loadingContent ? (
            <div className="memory-editor__loading">
              <div className="bde-skeleton memory-editor__skeleton" />
            </div>
          ) : selectedPath ? (
            <>
              <div className="memory-editor__toolbar">
                <span className="memory-editor__path">
                  memory/{selectedPath}
                  {isDirty && <span className="memory-editor__dirty"> &bull;</span>}
                </span>
                {selectedPath && (
                  <button
                    className={`memory-editor__agent-toggle ${activeFiles[selectedPath] ? 'memory-editor__agent-toggle--active' : ''}`}
                    onClick={() => toggleActive(selectedPath)}
                    title={
                      activeFiles[selectedPath]
                        ? 'Remove from agent knowledge'
                        : 'Add to agent knowledge'
                    }
                  >
                    <Brain size={14} />
                    <span>
                      {activeFiles[selectedPath]
                        ? 'Agent Knowledge: On'
                        : 'Agent Knowledge: Off'}
                    </span>
                  </button>
                )}
                <div className="memory-editor__actions">
                  <Button variant="ghost" size="sm" onClick={discard} disabled={!isDirty}>
                    Discard
                  </Button>
                  <Button variant="primary" size="sm" onClick={saveFile} disabled={!isDirty}>
                    Save
                  </Button>
                </div>
              </div>
              {activeCount > 0 && (
                <div
                  className={`memory-editor__size-banner ${activeTotalBytes > 30720 ? 'memory-editor__size-banner--warn' : ''}`}
                >
                  {activeCount} file{activeCount !== 1 ? 's' : ''} active (
                  {(activeTotalBytes / 1024).toFixed(1)} KB total)
                  {activeTotalBytes > 30720 && ' \u2014 Large memory may slow agent responses'}
                </div>
              )}
              <textarea
                ref={editorRef}
                className="memory-editor__textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            </>
          ) : (
            <EmptyState title="Select a file to view" />
          )}
        </div>
      </div>
      <ConfirmModal {...confirmProps} />
    </SettingsCard>
  )
}
