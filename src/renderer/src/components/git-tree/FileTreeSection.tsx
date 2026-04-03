import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { GitFileRow } from './GitFileRow'
import type { GitFileEntry } from '../../stores/gitTree'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileTreeSectionProps {
  title: string
  files: GitFileEntry[]
  isStaged: boolean
  selectedPath?: string | null
  onStageAll?: () => void
  onUnstageAll?: () => void
  onStageFile: (path: string) => void
  onUnstageFile: (path: string) => void
  onSelectFile: (path: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileTreeSection({
  title,
  files,
  isStaged,
  selectedPath,
  onStageAll,
  onUnstageAll,
  onStageFile,
  onUnstageFile,
  onSelectFile
}: FileTreeSectionProps): React.ReactElement | null {
  const [collapsed, setCollapsed] = useState(false)

  if (files.length === 0) return null

  function toggleCollapsed(): void {
    setCollapsed((c) => !c)
  }

  return (
    <div className="git-section">
      {/* Section header */}
      <div className="git-section__header">
        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          className="git-section__toggle"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>{title}</span>
          {/* File count badge */}
          <span aria-label={`${files.length} files`} className="git-section__count-badge">
            {files.length}
          </span>
        </button>

        {/* Stage All / Unstage All */}
        {isStaged && onUnstageAll && (
          <button
            onClick={onUnstageAll}
            aria-label="Unstage all"
            title="Unstage all"
            className="git-section__action-btn"
          >
            Unstage All
          </button>
        )}
        {!isStaged && onStageAll && (
          <button
            onClick={onStageAll}
            aria-label="Stage all"
            title="Stage all"
            className="git-section__action-btn"
          >
            Stage All
          </button>
        )}
      </div>

      {/* File list */}
      {!collapsed && (
        <div role="rowgroup" aria-label={title}>
          {files.map((file) => (
            <GitFileRow
              key={file.path}
              path={file.path}
              status={file.status}
              isStaged={isStaged}
              selected={selectedPath === file.path}
              onStage={onStageFile}
              onUnstage={onUnstageFile}
              onClick={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}
