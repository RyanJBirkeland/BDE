import React from 'react'
import { GitCommitHorizontal, Upload, Loader2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitBoxProps {
  commitMessage: string
  stagedCount: number
  commitLoading?: boolean
  pushLoading?: boolean
  pushDisabled?: boolean
  pushDisabledTitle?: string
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
  commitLoading = false,
  pushLoading = false,
  pushDisabled = false,
  pushDisabledTitle,
  onMessageChange,
  onCommit,
  onPush
}: CommitBoxProps): React.ReactElement {
  const canCommit = commitMessage.trim().length > 0 && stagedCount > 0 && !commitLoading

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (canCommit) onCommit()
    }
  }

  const firstLine = commitMessage.split('\n')[0]
  const charCount = firstLine.length
  const isOverLimit = charCount > 72

  return (
    <div className="git-commit-box">
      {/* Commit message textarea */}
      <textarea
        value={commitMessage}
        onChange={(e) => onMessageChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message (⌘↵ to commit)"
        aria-label="Commit message"
        rows={3}
        className="git-commit-box__textarea"
      />
      {commitMessage.length > 0 && (
        <div
          className={`git-commit-box__char-count${isOverLimit ? ' git-commit-box__char-count--over' : ''}`}
        >
          {charCount}/72
        </div>
      )}

      {/* Action buttons */}
      <div className="git-commit-box__actions">
        {/* Commit button */}
        <button
          onClick={onCommit}
          disabled={!canCommit}
          aria-label="Commit staged changes"
          aria-busy={commitLoading}
          title={
            commitLoading
              ? 'Committing...'
              : !canCommit
                ? stagedCount === 0
                  ? 'No staged changes'
                  : 'Enter a commit message'
                : 'Commit staged changes (⌘↵)'
          }
          className={`git-commit-box__commit-btn ${canCommit ? 'git-commit-box__commit-btn--enabled' : 'git-commit-box__commit-btn--disabled'}`}
        >
          {commitLoading ? (
            <Loader2 size={14} className="bde-spin" />
          ) : (
            <GitCommitHorizontal size={14} />
          )}
          {commitLoading ? 'Committing...' : 'Commit'}
          {!commitLoading && stagedCount > 0 && (
            <span className="git-commit-box__count">({stagedCount})</span>
          )}
        </button>

        {/* Push button */}
        <button
          onClick={onPush}
          disabled={pushLoading || pushDisabled}
          aria-label="Push to remote"
          aria-busy={pushLoading}
          title={
            pushDisabled && pushDisabledTitle
              ? pushDisabledTitle
              : pushLoading
                ? 'Pushing...'
                : 'Push to remote'
          }
          className="git-commit-box__push-btn"
        >
          {pushLoading ? <Loader2 size={14} className="bde-spin" /> : <Upload size={14} />}
          {pushLoading ? 'Pushing...' : 'Push'}
        </button>
      </div>
    </div>
  )
}
