import { useState, useEffect, useCallback } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Image,
  ChevronsUpDown,
  RefreshCw,
  Folder
} from 'lucide-react'
import { PanelHeader } from '../PanelHeader'
import { IconBtn } from '../IconBtn'
import { useIDEStore } from '../../../stores/ide'
import { HIDDEN_DIRS, type DirEntry } from '../file-tree-constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilesPanelProps {
  activeFilePath: string | null
  onOpenFile: (path: string) => void
}

// ---------------------------------------------------------------------------
// File icon helpers
// ---------------------------------------------------------------------------

function resolveFileIcon(name: string): React.ReactElement {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'cpp', 'c', 'java'].includes(ext))
    return <FileCode size={14} />
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return <FileJson size={14} />
  if (['md', 'mdx', 'txt', 'rst'].includes(ext)) return <FileText size={14} />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return <Image size={14} />
  return <File size={14} />
}

// ---------------------------------------------------------------------------
// Tree row
// ---------------------------------------------------------------------------

interface TreeRowProps {
  name: string
  type: 'file' | 'directory'
  fullPath: string
  depth: number
  activeFilePath: string | null
  onOpenFile: (path: string) => void
}

function TreeRow({
  name,
  type,
  fullPath,
  depth,
  activeFilePath,
  onOpenFile
}: TreeRowProps): React.JSX.Element {
  const expandedDirs = useIDEStore((s) => s.expandedDirs)
  const toggleDir = useIDEStore((s) => s.toggleDir)
  const [children, setChildren] = useState<DirEntry[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const isExpanded = expandedDirs[fullPath] ?? false
  const isActive = type === 'file' && fullPath === activeFilePath

  // TODO(phase-6.5): wire agent-file-touch signal from agentHistory store
  const hasAgentTouched = false

  useEffect(() => {
    if (type !== 'directory' || !isExpanded) return
    window.api.fs
      .readDir(fullPath)
      .then((entries) => {
        setChildren(
          entries
            .filter((e) => !HIDDEN_DIRS.has(e.name))
            .sort((a, b) => {
              if (a.type === b.type) return a.name.localeCompare(b.name)
              return a.type === 'directory' ? -1 : 1
            })
        )
      })
      .catch(() => setChildren([]))
  }, [type, fullPath, isExpanded, refreshKey])

  // Re-read directory when filesystem changes
  useEffect(() => {
    if (type !== 'directory' || !isExpanded) return
    const unsubscribe = window.api.fs.onDirChanged((changedPath: string) => {
      if (fullPath === changedPath || fullPath.startsWith(changedPath + '/')) {
        setRefreshKey((k) => k + 1)
      }
    })
    return unsubscribe
  }, [fullPath, type, isExpanded])

  function handleClick(): void {
    if (type === 'directory') {
      toggleDir(fullPath)
    } else {
      onOpenFile(fullPath)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    } else if (type === 'directory' && e.key === 'ArrowRight' && !isExpanded) {
      e.preventDefault()
      toggleDir(fullPath)
    } else if (type === 'directory' && e.key === 'ArrowLeft' && isExpanded) {
      e.preventDefault()
      toggleDir(fullPath)
    }
  }

  const paddingLeft = 8 + depth * 14

  return (
    <div role="none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={type === 'directory' ? isExpanded : undefined}
        aria-selected={isActive}
        data-path={fullPath}
        data-type={type === 'directory' ? 'folder' : 'file'}
        title={fullPath}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{
          position: 'relative',
          paddingLeft,
          paddingRight: 'var(--s-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-1)',
          height: 26,
          cursor: 'pointer',
          borderRadius: 'var(--r-sm)',
          background: isActive ? 'var(--accent-soft)' : 'transparent',
          outline: 'none'
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'var(--surf-2)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isActive ? 'var(--accent-soft)' : 'transparent'
        }}
        onFocus={(e) => {
          e.currentTarget.style.outline = '2px solid var(--accent-line)'
          e.currentTarget.style.outlineOffset = '1px'
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = 'none'
        }}
      >
        {/* 2px active accent rail */}
        {isActive && (
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 2,
              background: 'var(--accent)',
              borderRadius: '0 2px 2px 0'
            }}
          />
        )}

        {/* Chevron or spacer */}
        <span
          style={{ width: 12, flexShrink: 0, color: 'var(--fg-3)', display: 'flex', alignItems: 'center' }}
        >
          {type === 'directory' ? (
            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </span>

        {/* Folder / file icon */}
        <span
          style={{
            flexShrink: 0,
            color: type === 'directory' ? 'var(--fg-3)' : 'var(--fg-3)',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          {type === 'directory' ? (
            isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            resolveFileIcon(name)
          )}
        </span>

        {/* Name */}
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--t-sm)',
            color: isActive
              ? 'var(--accent)'
              : type === 'directory'
                ? 'var(--fg-2)'
                : 'var(--fg)'
          }}
        >
          {name}
        </span>

        {/* Agent-touch dot — static, no pulse (Pulse Rule) */}
        {hasAgentTouched && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--st-running)',
              flexShrink: 0
            }}
          />
        )}
      </div>

      {type === 'directory' && isExpanded && (
        <div>
          {children.map((child) => (
            <TreeRow
              key={child.name}
              name={child.name}
              type={child.type}
              fullPath={`${fullPath}/${child.name}`}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root tree — loads top-level entries for rootPath
// ---------------------------------------------------------------------------

interface RootTreeProps {
  rootPath: string
  activeFilePath: string | null
  onOpenFile: (path: string) => void
}

function RootTree({ rootPath, activeFilePath, onOpenFile }: RootTreeProps): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const raw = await window.api.fs.readDir(rootPath)
      setEntries(
        raw
          .filter((e) => !HIDDEN_DIRS.has(e.name))
          .sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name)
            return a.type === 'directory' ? -1 : 1
          })
      )
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [rootPath])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  useEffect(() => {
    const unsubscribe = window.api.fs.onDirChanged(() => {
      void loadEntries()
    })
    return unsubscribe
  }, [loadEntries])

  if (loading) {
    return (
      <div style={{ padding: 'var(--s-2)' }}>
        <div className="view-skeleton" style={{ height: 20, marginBottom: 6 }} />
        <div className="view-skeleton" style={{ height: 20, marginBottom: 6 }} />
        <div className="view-skeleton" style={{ height: 20 }} />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--s-3)',
          color: 'var(--fg-3)',
          fontSize: 'var(--t-sm)',
          textAlign: 'center'
        }}
      >
        Empty folder
      </div>
    )
  }

  return (
    <div role="tree" aria-label="File explorer">
      {entries.map((entry) => (
        <TreeRow
          key={entry.name}
          name={entry.name}
          type={entry.type}
          fullPath={`${rootPath}/${entry.name}`}
          depth={0}
          activeFilePath={activeFilePath}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilesPanel
// ---------------------------------------------------------------------------

export function FilesPanel({ activeFilePath, onOpenFile }: FilesPanelProps): React.JSX.Element {
  const rootPath = useIDEStore((s) => s.rootPath)

  return (
    <>
      <PanelHeader eyebrow="EXPLORER">
        <IconBtn
          icon={<FilePlus size={14} />}
          title="New File"
          onClick={() => console.log('TODO')}
        />
        <IconBtn
          icon={<FolderPlus size={14} />}
          title="New Folder"
          onClick={() => console.log('TODO')}
        />
        <IconBtn
          icon={<RefreshCw size={14} />}
          title="Refresh"
          onClick={() => console.log('TODO')}
        />
        <IconBtn
          icon={<ChevronsUpDown size={14} />}
          title="Collapse All"
          onClick={() => console.log('TODO')}
        />
      </PanelHeader>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--s-1) var(--s-2)',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--line) transparent'
        }}
      >
        {rootPath ? (
          <RootTree
            rootPath={rootPath}
            activeFilePath={activeFilePath}
            onOpenFile={onOpenFile}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 'var(--s-2)',
              color: 'var(--fg-3)'
            }}
          >
            <span className="fleet-eyebrow">NO FOLDER OPEN</span>
            <span style={{ fontSize: 'var(--t-sm)' }}>Open a folder to see files.</span>
          </div>
        )}
      </div>
    </>
  )
}
