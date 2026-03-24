import React from 'react'
import { Plus, Minus } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

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

function statusColor(status: string): string {
  switch (status) {
    case 'M':
      return tokens.color.warning
    case 'A':
      return tokens.color.success
    case 'D':
      return tokens.color.danger
    case '?':
      return tokens.color.textMuted
    default:
      return tokens.color.text
  }
}

function splitPath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash === -1) return { dir: '', name: filePath }
  return {
    dir: filePath.slice(0, lastSlash + 1),
    name: filePath.slice(lastSlash + 1),
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
  onClick,
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[1]} ${tokens.space[3]}`,
        cursor: 'pointer',
        backgroundColor: selected ? tokens.color.accentDim : 'transparent',
        borderRadius: tokens.radius.sm,
        fontSize: tokens.size.sm,
        fontFamily: tokens.font.ui,
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          ;(e.currentTarget as HTMLDivElement).style.backgroundColor =
            tokens.color.surfaceHigh
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          ;(e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'
        }
      }}
    >
      {/* Status letter */}
      <span
        style={{
          color: statusColor(status),
          fontWeight: 600,
          fontFamily: tokens.font.code,
          fontSize: tokens.size.xs,
          width: '12px',
          flexShrink: 0,
          textAlign: 'center',
        }}
        aria-label={`status: ${status}`}
      >
        {status}
      </span>

      {/* File path */}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {dir && (
          <span style={{ color: tokens.color.textMuted }}>{dir}</span>
        )}
        <span style={{ color: tokens.color.text }}>{name}</span>
      </span>

      {/* Stage / Unstage button */}
      <button
        onClick={handleStageClick}
        aria-label={isStaged ? `Unstage ${name}` : `Stage ${name}`}
        title={isStaged ? 'Unstage file' : 'Stage file'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '20px',
          height: '20px',
          borderRadius: tokens.radius.sm,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: tokens.color.textMuted,
          flexShrink: 0,
          padding: 0,
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
        {isStaged ? <Minus size={12} /> : <Plus size={12} />}
      </button>
    </div>
  )
}

export default GitFileRow
