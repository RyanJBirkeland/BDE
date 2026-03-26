import React from 'react'
import { X } from 'lucide-react'
import { tokens } from '../../design-system/tokens'
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

function lineColor(line: string): string {
  if (line.startsWith('+')) return tokens.color.success
  if (line.startsWith('-')) return tokens.color.danger
  if (line.startsWith('@@')) return tokens.color.info
  return tokens.color.text
}

function lineBackground(line: string): string {
  if (line.startsWith('+')) return 'rgba(0, 211, 127, 0.07)'
  if (line.startsWith('-')) return 'rgba(255, 77, 77, 0.07)'
  if (line.startsWith('@@')) return 'rgba(59, 130, 246, 0.07)'
  return 'transparent'
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
    <div
      role="region"
      aria-label={`Diff for ${fileName}`}
      style={{
        borderTop: `1px solid ${tokens.color.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        maxHeight: '40%',
        minHeight: '120px',
        backgroundColor: tokens.color.surface
      }}
    >
      {/* Drawer header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${tokens.space[1]} ${tokens.space[3]}`,
          borderBottom: `1px solid ${tokens.color.border}`,
          flexShrink: 0
        }}
      >
        <span
          style={{
            fontSize: tokens.size.sm,
            fontFamily: tokens.font.code,
            color: tokens.color.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {selectedFile.path}
        </span>
        <button
          onClick={onClose}
          aria-label="Close diff"
          title="Close diff"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: tokens.color.textMuted,
            borderRadius: tokens.radius.sm,
            flexShrink: 0
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.text
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = tokens.color.textMuted
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Diff content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          fontFamily: tokens.font.code,
          fontSize: tokens.size.sm
        }}
      >
        {lines.length === 0 ? (
          <div
            style={{
              padding: tokens.space[3],
              color: tokens.color.textMuted,
              textAlign: 'center',
              fontSize: tokens.size.sm,
              fontFamily: tokens.font.ui
            }}
          >
            No diff available
          </div>
        ) : (
          lines.map((line, index) => (
            <div
              key={index}
              style={{
                display: 'block',
                padding: `1px ${tokens.space[3]}`,
                color: lineColor(line),
                backgroundColor: lineBackground(line),
                whiteSpace: 'pre',
                lineHeight: '1.6'
              }}
            >
              {line || ' '}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default InlineDiffDrawer
