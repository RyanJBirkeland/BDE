import React from 'react'
import type { DiffFile } from '../../lib/diff-parser'
import { EmptyState } from '../ui/EmptyState'

interface DiffFileListProps {
  files: DiffFile[]
  activeFileIndex: number
  onSelect: (index: number) => void
}

export function DiffFileList({
  files,
  activeFileIndex,
  onSelect
}: DiffFileListProps): React.JSX.Element {
  return (
    <div className="diff-sidebar">
      <div className="diff-sidebar__header">
        <span className="diff-sidebar__title">Files</span>
        <span className="diff-sidebar__count bde-count-badge">{files.length}</span>
      </div>
      <div className="diff-sidebar__list">
        {files.length === 0 && (
          <EmptyState message="No files changed. The diff is empty." />
        )}
        {files.map((f, i) => (
          <button
            key={f.path}
            className={`diff-file-item ${activeFileIndex === i ? 'diff-file-item--active' : ''}`}
            onClick={() => onSelect(i)}
          >
            <span className="diff-file-item__name">{f.path.split('/').pop()}</span>
            <span className="diff-file-item__badge">
              {f.additions > 0 && <span className="diff-file-item__add">+{f.additions}</span>}
              {f.deletions > 0 && <span className="diff-file-item__del">-{f.deletions}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
