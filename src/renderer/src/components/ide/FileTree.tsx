import { useState, useEffect, useCallback } from 'react'
import { FileTreeNode } from './FileTreeNode'
import { HIDDEN_DIRS, DirEntry } from './file-tree-constants'

export interface FileTreeProps {
  dirPath: string
  onOpenFile: (filePath: string) => void
}

export function FileTree({ dirPath, onOpenFile }: FileTreeProps): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadEntries = useCallback(() => {
    window.api.readDir(dirPath)
      .then((raw) => {
        setEntries(raw
          .filter((e) => !HIDDEN_DIRS.has(e.name))
          .sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name)
            return a.type === 'directory' ? -1 : 1
          }))
        setError(null)
      })
      .catch(() => setError('Failed to read directory'))
  }, [dirPath])

  useEffect(() => { loadEntries() }, [loadEntries])
  useEffect(() => {
    const unsubscribe = window.api.onDirChanged(() => loadEntries())
    return unsubscribe
  }, [loadEntries])

  if (error) {
    return <div className="ide-file-tree" style={{ padding: '8px', color: 'var(--bde-danger)', fontSize: 'var(--bde-size-sm)' }}>{error}</div>
  }

  return (
    <div className="ide-file-tree" role="tree" aria-label="File explorer">
      {entries.map((entry) => (
        <FileTreeNode key={entry.name} name={entry.name} type={entry.type}
          fullPath={`${dirPath}/${entry.name}`} depth={0} onOpenFile={onOpenFile} />
      ))}
    </div>
  )
}
