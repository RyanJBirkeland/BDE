import React from 'react'
import { Plus, Minus } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitFileRowProps {
  path: string
  status: string
  isStaged: boolean
  selected?: boolean
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onClick: (path: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusClassName(status: string): string {
  switch (status) {
    case 'M':
      return 'git-file-row__status--modified'
    case 'A':
      return 'git-file-row__status--added'
    case 'D':
      return 'git-file-row__status--deleted'
    case '?':
      return 'git-file-row__status--untracked'
    default:
      return ''
  }
}

function splitPath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash === -1) return { dir: '', name: filePath }
  return {
    dir: filePath.slice(0, lastSlash + 1),
    name: filePath.slice(lastSlash + 1)
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GitFileRow({
  path,
  status,
  isStaged,
  selected = false,
  onStage,
  onUnstage,
  onClick
}: GitFileRowProps): React.ReactElement {
  const { dir, name } = splitPath(path)

  function handleRowClick(e: React.MouseEvent): void {
    e.stopPropagation()
    onClick(path)
  }

  function handleStageClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (isStaged) {
      onUnstage(path)
    } else {
      onStage(path)
    }
  }

  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={handleRowClick}
      className={`git-file-row ${selected ? 'git-file-row--selected' : ''}`}
    >
      {/* Status letter */}
      <span
        className={`git-file-row__status ${statusClassName(status)}`}
        aria-label={`status: ${status}`}
      >
        {status}
      </span>

      {/* File path */}
      <span className="git-file-row__path" title={path}>
        {dir && <span className="git-file-row__path-dir">{dir}</span>}
        <span className="git-file-row__path-name">{name}</span>
      </span>

      {/* Stage / Unstage button */}
      <button
        onClick={handleStageClick}
        aria-label={isStaged ? `Unstage ${name}` : `Stage ${name}`}
        title={isStaged ? 'Unstage file' : 'Stage file'}
        className="git-file-row__stage-btn"
      >
        {isStaged ? <Minus size={12} /> : <Plus size={12} />}
      </button>
    </div>
  )
}
