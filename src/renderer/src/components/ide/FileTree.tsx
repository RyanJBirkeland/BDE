import { useState, useEffect, useCallback } from 'react'
import { FileTreeNode } from './FileTreeNode'
import { HIDDEN_DIRS, DirEntry } from './file-tree-constants'
import { EmptyState } from '../ui/EmptyState'
import './FileTree.css'

export interface FileTreeProps {
  dirPath: string
  onOpenFile: (filePath: string) => void
}

export function FileTree({ dirPath, onOpenFile }: FileTreeProps): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadEntries = useCallback(() => {
    setIsLoading(true)
    window.api.fs
      .readDir(dirPath)
      .then((raw) => {
        setEntries(
          raw
            .filter((e) => !HIDDEN_DIRS.has(e.name))
            .sort((a, b) => {
              if (a.type === b.type) return a.name.localeCompare(b.name)
              return a.type === 'directory' ? -1 : 1
            })
        )
        setError(null)
        setIsLoading(false)
      })
      .catch(() => {
        setError('Failed to read directory')
        setIsLoading(false)
      })
  }, [dirPath])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])
  useEffect(() => {
    const unsubscribe = window.api.fs.onDirChanged(() => loadEntries())
    return unsubscribe
  }, [loadEntries])

  if (error) {
    return (
      <div className="ide-file-tree">
        <div className="ide-file-tree__error">{error}</div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="ide-file-tree">
        <div className="view-skeleton" style={{ height: '24px', margin: '8px' }} />
        <div className="view-skeleton" style={{ height: '24px', margin: '8px' }} />
        <div className="view-skeleton" style={{ height: '24px', margin: '8px' }} />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="ide-file-tree">
        <EmptyState message="Empty folder" />
      </div>
    )
  }

  return (
    <div className="ide-file-tree" role="tree" aria-label="File explorer">
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.name}
          name={entry.name}
          type={entry.type}
          fullPath={`${dirPath}/${entry.name}`}
          depth={0}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  )
}
