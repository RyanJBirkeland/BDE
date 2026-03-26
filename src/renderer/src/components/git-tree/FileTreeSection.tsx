import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { tokens } from '../../design-system/tokens'
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
    <div style={{ marginBottom: tokens.space[2] }}>
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: `${tokens.space[1]} ${tokens.space[3]}`,
          gap: tokens.space[1],
          userSelect: 'none'
        }}
      >
        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[1],
            flex: 1,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: tokens.color.textMuted,
            fontSize: tokens.size.xs,
            fontFamily: tokens.font.ui,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: 0,
            textAlign: 'left'
          }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>{title}</span>
          {/* File count badge */}
          <span
            aria-label={`${files.length} files`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '16px',
              height: '16px',
              padding: `0 ${tokens.space[1]}`,
              backgroundColor: tokens.color.surfaceHigh,
              borderRadius: tokens.radius.full,
              fontSize: tokens.size.xs,
              color: tokens.color.textMuted,
              fontWeight: 400
            }}
          >
            {files.length}
          </span>
        </button>

        {/* Stage All / Unstage All */}
        {isStaged && onUnstageAll && (
          <button
            onClick={onUnstageAll}
            aria-label="Unstage all"
            title="Unstage all"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: tokens.color.textMuted,
              fontSize: tokens.size.xs,
              fontFamily: tokens.font.ui,
              padding: `2px ${tokens.space[1]}`,
              borderRadius: tokens.radius.sm
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.text
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor =
                tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.textMuted
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
            }}
          >
            Unstage All
          </button>
        )}
        {!isStaged && onStageAll && (
          <button
            onClick={onStageAll}
            aria-label="Stage all"
            title="Stage all"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: tokens.color.textMuted,
              fontSize: tokens.size.xs,
              fontFamily: tokens.font.ui,
              padding: `2px ${tokens.space[1]}`,
              borderRadius: tokens.radius.sm
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.text
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor =
                tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.textMuted
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
            }}
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

export default FileTreeSection
