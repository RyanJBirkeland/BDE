import React, { useState } from 'react'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import type { GitFileEntry } from '../../stores/gitTree'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InlineDiffDrawerProps {
  selectedFile: GitFileEntry | null
  diffContent: string
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineClassName(line: string): string {
  if (line.startsWith('+')) return 'git-diff-drawer__line--add'
  if (line.startsWith('-')) return 'git-diff-drawer__line--delete'
  if (line.startsWith('@@')) return 'git-diff-drawer__line--meta'
  return 'git-diff-drawer__line--default'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InlineDiffDrawer({
  selectedFile,
  diffContent,
  onClose
}: InlineDiffDrawerProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false)

  if (!selectedFile) return null

  const lines = diffContent ? diffContent.split('\n') : []
  const fileName = selectedFile.path.split('/').pop() ?? selectedFile.path

  return (
    <div
      role="region"
      aria-label={`Diff for ${fileName}`}
      className={`git-diff-drawer${expanded ? ' git-diff-drawer--expanded' : ''}`}
    >
      {/* Drawer header */}
      <div className="git-diff-drawer__header">
        <span className="git-diff-drawer__path" title={selectedFile.path}>
          {selectedFile.path}
        </span>
        <div className="git-diff-drawer__header-actions">
          <button
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Collapse diff' : 'Expand diff to fullscreen'}
            title={expanded ? 'Collapse' : 'Expand'}
            className="git-diff-drawer__close-btn"
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            aria-label="Close diff"
            title="Close diff"
            className="git-diff-drawer__close-btn"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="git-diff-drawer__content">
        {lines.length === 0 ? (
          <div className="git-diff-drawer__empty">No diff available</div>
        ) : (
          lines.map((line, index) => (
            <div key={index} className={`git-diff-drawer__line ${lineClassName(line)}`}>
              {line || ' '}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
