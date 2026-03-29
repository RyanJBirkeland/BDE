import React from 'react'
import { GitCommitHorizontal, Upload } from 'lucide-react'

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

      {/* Action buttons */}
      <div className="git-commit-box__actions">
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
          className={`git-commit-box__commit-btn ${canCommit ? 'git-commit-box__commit-btn--enabled' : 'git-commit-box__commit-btn--disabled'}`}
        >
          <GitCommitHorizontal size={14} />
          Commit
          {stagedCount > 0 && <span className="git-commit-box__count">({stagedCount})</span>}
        </button>

        {/* Push button */}
        <button
          onClick={onPush}
          aria-label="Push to remote"
          title="Push to remote"
          className="git-commit-box__push-btn"
        >
          <Upload size={14} />
          Push
        </button>
      </div>
    </div>
  )
}

export default CommitBox
