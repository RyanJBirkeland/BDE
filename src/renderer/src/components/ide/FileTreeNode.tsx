import { useState, useEffect } from 'react'
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  Image
} from 'lucide-react'
import { useIDEStore } from '../../stores/ide'
import { HIDDEN_DIRS, DirEntry } from './file-tree-constants'

export interface FileTreeNodeProps {
  name: string
  type: 'file' | 'directory'
  fullPath: string
  depth: number
  onOpenFile: (filePath: string) => void
}

function getFileIcon(name: string): React.ReactElement {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'cpp', 'c', 'java'].includes(ext))
    return <FileCode size={14} />
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return <FileJson size={14} />
  if (['md', 'mdx', 'txt', 'rst'].includes(ext)) return <FileText size={14} />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return <Image size={14} />
  return <File size={14} />
}

export function FileTreeNode({
  name,
  type,
  fullPath,
  depth,
  onOpenFile
}: FileTreeNodeProps): React.JSX.Element {
  const expandedDirs = useIDEStore((s) => s.expandedDirs)
  const toggleDir = useIDEStore((s) => s.toggleDir)
  // Derive activeFilePath instead of subscribing to full openTabs array
  const activeFilePath = useIDEStore((s) => {
    const activeTab = s.openTabs.find((t) => t.id === s.activeTabId)
    return activeTab?.filePath ?? null
  })
  const [children, setChildren] = useState<DirEntry[]>([])
  const [loadError, setLoadError] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const isExpanded = expandedDirs[fullPath] ?? false
  const isActive = activeFilePath === fullPath

  // IDE-13: Listen for filesystem changes and refresh expanded directories
  // Only subscribe when this is an expanded directory to avoid listener leak
  useEffect(() => {
    if (type !== 'directory' || !isExpanded) return
    const cleanup = window.api.onDirChanged((changedPath: string) => {
      // Refresh if this directory or a parent directory changed
      if (fullPath === changedPath || fullPath.startsWith(changedPath + '/')) {
        setRefreshTrigger((prev) => prev + 1)
      }
    })
    return cleanup
  }, [fullPath, type, isExpanded])

  useEffect(() => {
    if (type === 'directory' && isExpanded) {
      window.api
        .readDir(fullPath)
        .then((entries) => {
          setLoadError(false)
          setChildren(
            entries
              .filter((e) => !HIDDEN_DIRS.has(e.name))
              .sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name)
                return a.type === 'directory' ? -1 : 1
              })
          )
        })
        .catch(() => setLoadError(true))
    }
  }, [type, fullPath, isExpanded, refreshTrigger])

  const paddingLeft = 8 + depth * 16

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (type === 'directory') {
        toggleDir(fullPath)
      } else {
        onOpenFile(fullPath)
      }
    } else if (type === 'directory') {
      if (e.key === 'ArrowRight' && !isExpanded) {
        e.preventDefault()
        toggleDir(fullPath)
      } else if (e.key === 'ArrowLeft' && isExpanded) {
        e.preventDefault()
        toggleDir(fullPath)
      }
    }
  }

  return (
    <div className="ide-file-node-wrapper" role="none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={type === 'directory' ? isExpanded : undefined}
        aria-selected={isActive}
        className={`ide-file-node${isActive ? ' ide-file-node--active' : ''}`}
        data-type={type === 'directory' ? 'folder' : 'file'}
        data-path={fullPath}
        style={{ paddingLeft }}
        onClick={() => (type === 'directory' ? toggleDir(fullPath) : onOpenFile(fullPath))}
        onKeyDown={handleKeyDown}
        title={fullPath}
      >
        <span className="ide-file-node__chevron">
          {type === 'directory' ? (
            isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : null}
        </span>
        <span className="ide-file-node__icon">
          {type === 'directory' ? (
            isExpanded ? (
              <FolderOpen size={14} color="var(--bde-accent)" />
            ) : (
              <Folder size={14} color="var(--bde-accent)" />
            )
          ) : (
            getFileIcon(name)
          )}
        </span>
        <span className="ide-file-node__name">{name}</span>
      </div>
      {type === 'directory' && isExpanded && (
        <div className="ide-file-node__children">
          {loadError ? (
            <div className="ide-file-node__error" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
              Failed to read directory
            </div>
          ) : (
            children.map((child) => (
              <FileTreeNode
                key={child.name}
                name={child.name}
                type={child.type}
                fullPath={`${fullPath}/${child.name}`}
                depth={depth + 1}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
