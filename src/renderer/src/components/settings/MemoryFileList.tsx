import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, FileText, Search } from 'lucide-react'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import type { MemorySearchResult } from '../../services/memory'
import type { MemoryFile } from './useMemoryFiles'
import { MemorySearch } from './MemorySearch'

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

interface MemoryFileListProps {
  files: MemoryFile[]
  loadingFiles: boolean
  selectedPath: string | null
  activeFiles: Record<string, boolean>
  searchQuery: string
  searchResults: MemorySearchResult[]
  isSearching: boolean
  onSelectFile: (path: string) => void
  onSearch: (query: string) => void
  onClearSearch: () => void
  onLoadFiles: () => void
  onToggleActive: (path: string) => void
  onNewFileClick: () => void
  activeCount: number
  newFilePrompt: boolean
  newFileName: string
  creating: boolean
  onNewFileNameChange: (name: string) => void
  onNewFileSubmit: () => void
  onNewFileCancel: () => void
}

export function MemoryFileList({
  files,
  loadingFiles,
  selectedPath,
  activeFiles,
  searchQuery,
  searchResults,
  isSearching,
  onSelectFile,
  onSearch,
  onClearSearch,
  onLoadFiles,
  onToggleActive,
  onNewFileClick,
  activeCount,
  newFilePrompt,
  newFileName,
  creating,
  onNewFileNameChange,
  onNewFileSubmit,
  onNewFileCancel
}: MemoryFileListProps): React.JSX.Element {
  const [focusIndex, setFocusIndex] = useState(-1)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const activeView = usePanelLayoutStore((s) => s.activeView)

  const { pinned, groups } = groupFiles(files)
  const flatFiles = useMemo(() => {
    const list: MemoryFile[] = []
    if (pinned) list.push(pinned)
    for (const g of groups) list.push(...g.files)
    return list
  }, [pinned, groups])

  const handleSelectFile = useCallback(
    (path: string) => {
      onSelectFile(path)
    },
    [onSelectFile]
  )

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
        const target = flatFiles[focusIndex]
        if (target) handleSelectFile(target.path)
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

  return (
    <div className="memory-sidebar">
      <div className="memory-sidebar__header">
        <span className="memory-sidebar__title">Files</span>
        <span className="memory-sidebar__count bde-count-badge">{files.length}</span>
        <div className="memory-sidebar__actions">
          <Button
            variant="icon"
            size="sm"
            onClick={onNewFileClick}
            title="New file"
            aria-label="New file"
          >
            +
          </Button>
          <Button
            variant="icon"
            size="sm"
            onClick={onLoadFiles}
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
            onChange={(e) => onNewFileNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onNewFileSubmit()
              if (e.key === 'Escape') onNewFileCancel()
            }}
            placeholder="filename.md"
            disabled={creating}
            autoFocus
          />
        </div>
      )}

      <MemorySearch searchQuery={searchQuery} onSearch={onSearch} onClearSearch={onClearSearch} />

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
                          <span className="memory-search-result__content">{match.content}</span>
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
                    {formatRelativeTime(pinned.modifiedAt)} &middot; {formatSize(pinned.size)}
                  </span>
                </div>
                <button
                  className={`memory-file__toggle ${activeFiles[pinned.path] ? 'memory-file__toggle--active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleActive(pinned.path)
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
                          onToggleActive(f.path)
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
                action={{ label: 'New File', onClick: onNewFileClick }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
