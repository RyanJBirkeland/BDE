import React from 'react'
import { GitCommitHorizontal, Upload } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitBoxProps {
  commitMessage: string
  stagedCount: number
  onMessageChange: (msg: string) => void
  onCommit: () => void
  onPush: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommitBox({
  commitMessage,
  stagedCount,
  onMessageChange,
  onCommit,
  onPush
}: CommitBoxProps): React.ReactElement {
  const canCommit = commitMessage.trim().length > 0 && stagedCount > 0

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (canCommit) onCommit()
    }
  }

  return (
    <div
      style={{
        padding: tokens.space[3],
        borderBottom: `1px solid ${tokens.color.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[2]
      }}
    >
      {/* Commit message textarea */}
      <textarea
        value={commitMessage}
        onChange={(e) => onMessageChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message (⌘↵ to commit)"
        aria-label="Commit message"
        rows={3}
        style={{
          width: '100%',
          resize: 'vertical',
          backgroundColor: tokens.color.surfaceHigh,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.sm,
          color: tokens.color.text,
          fontSize: tokens.size.sm,
          fontFamily: tokens.font.ui,
          padding: tokens.space[2],
          boxSizing: 'border-box',
          outline: 'none',
          lineHeight: '1.5'
        }}
        onFocus={(e) => {
          ;(e.currentTarget as HTMLTextAreaElement).style.borderColor = tokens.color.accent
        }}
        onBlur={(e) => {
          ;(e.currentTarget as HTMLTextAreaElement).style.borderColor = tokens.color.border
        }}
      />

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: tokens.space[2] }}>
        {/* Commit button */}
        <button
          onClick={onCommit}
          disabled={!canCommit}
          aria-label="Commit staged changes"
          title={
            !canCommit
              ? stagedCount === 0
                ? 'No staged changes'
                : 'Enter a commit message'
              : 'Commit staged changes (⌘↵)'
          }
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens.space[1],
            padding: `${tokens.space[1]} ${tokens.space[2]}`,
            backgroundColor: canCommit ? tokens.color.accent : tokens.color.surfaceHigh,
            color: canCommit ? 'var(--bde-btn-primary-text)' : tokens.color.textDim,
            border: 'none',
            borderRadius: tokens.radius.sm,
            fontSize: tokens.size.sm,
            fontFamily: tokens.font.ui,
            fontWeight: 600,
            cursor: canCommit ? 'pointer' : 'not-allowed'
          }}
        >
          <GitCommitHorizontal size={14} />
          Commit
          {stagedCount > 0 && (
            <span style={{ fontSize: tokens.size.xs, opacity: 0.8 }}>({stagedCount})</span>
          )}
        </button>

        {/* Push button */}
        <button
          onClick={onPush}
          aria-label="Push to remote"
          title="Push to remote"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens.space[1],
            padding: `${tokens.space[1]} ${tokens.space[3]}`,
            backgroundColor: tokens.color.surfaceHigh,
            color: tokens.color.text,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            fontSize: tokens.size.sm,
            fontFamily: tokens.font.ui,
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = tokens.color.borderHover
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = tokens.color.border
          }}
        >
          <Upload size={14} />
          Push
        </button>
      </div>
    </div>
  )
}

export default CommitBox
