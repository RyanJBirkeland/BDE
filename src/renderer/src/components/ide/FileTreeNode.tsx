import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FileCode, FileText, FileJson, Image } from 'lucide-react'
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
  if (['ts','tsx','js','jsx','py','go','rs','cpp','c','java'].includes(ext)) return <FileCode size={14} />
  if (['json','yaml','yml','toml'].includes(ext)) return <FileJson size={14} />
  if (['md','mdx','txt','rst'].includes(ext)) return <FileText size={14} />
  if (['png','jpg','jpeg','gif','svg','webp','ico'].includes(ext)) return <Image size={14} />
  return <File size={14} />
}

export function FileTreeNode({ name, type, fullPath, depth, onOpenFile }: FileTreeNodeProps): React.JSX.Element {
  const expandedDirs = useIDEStore((s) => s.expandedDirs)
  const toggleDir = useIDEStore((s) => s.toggleDir)
  const activeTabId = useIDEStore((s) => s.activeTabId)
  const openTabs = useIDEStore((s) => s.openTabs)
  const [children, setChildren] = useState<DirEntry[]>([])
  const isExpanded = expandedDirs[fullPath] ?? false
  const activeTab = openTabs.find((t) => t.id === activeTabId)
  const isActive = activeTab?.filePath === fullPath

  useEffect(() => {
    if (type === 'directory' && isExpanded) {
      window.api.readDir(fullPath)
        .then((entries) => {
          setChildren(entries
            .filter((e) => !HIDDEN_DIRS.has(e.name))
            .sort((a, b) => {
              if (a.type === b.type) return a.name.localeCompare(b.name)
              return a.type === 'directory' ? -1 : 1
            }))
        })
        .catch(() => {})
    }
  }, [type, fullPath, isExpanded])

  const paddingLeft = 8 + depth * 16

  return (
    <div className="ide-file-node-wrapper" role="none">
      <div role="treeitem" aria-expanded={type === 'directory' ? isExpanded : undefined} aria-selected={isActive}
        className={`ide-file-node${isActive ? ' ide-file-node--active' : ''}`}
        style={{ paddingLeft }} onClick={() => type === 'directory' ? toggleDir(fullPath) : onOpenFile(fullPath)}
        title={fullPath}
      >
        <span className="ide-file-node__icon">
          {type === 'directory' ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </span>
        <span className="ide-file-node__icon">
          {type === 'directory' ? (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />) : getFileIcon(name)}
        </span>
        <span className="ide-file-node__name">{name}</span>
      </div>
      {type === 'directory' && isExpanded && (
        <div className="ide-file-node__children">
          {children.map((child) => (
            <FileTreeNode key={child.name} name={child.name} type={child.type}
              fullPath={`${fullPath}/${child.name}`} depth={depth + 1} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  )
}
