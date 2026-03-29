import React from 'react'
import { X } from 'lucide-react'
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
  if (!selectedFile) return null

  const lines = diffContent ? diffContent.split('\n') : []
  const fileName = selectedFile.path.split('/').pop() ?? selectedFile.path

  return (
    <div role="region" aria-label={`Diff for ${fileName}`} className="git-diff-drawer">
      {/* Drawer header */}
      <div className="git-diff-drawer__header">
        <span className="git-diff-drawer__path">{selectedFile.path}</span>
        <button
          onClick={onClose}
          aria-label="Close diff"
          title="Close diff"
          className="git-diff-drawer__close-btn"
        >
          <X size={14} />
        </button>
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

export default InlineDiffDrawer
