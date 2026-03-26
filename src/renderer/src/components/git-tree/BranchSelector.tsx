import React, { useState } from 'react'
import { GitBranch, ChevronDown } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchSelectorProps {
  currentBranch: string
  branches: string[]
  hasUncommittedChanges: boolean
  onCheckout: (branch: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BranchSelector({
  currentBranch,
  branches,
  hasUncommittedChanges,
  onCheckout
}: BranchSelectorProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)

  const isDisabled = hasUncommittedChanges

  function toggleDropdown(): void {
    if (isDisabled) return
    setIsOpen((o) => !o)
  }

  function handleSelect(branch: string): void {
    if (branch === currentBranch) {
      setIsOpen(false)
      return
    }
    onCheckout(branch)
    setIsOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') setIsOpen(false)
  }

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger button */}
      <button
        onClick={toggleDropdown}
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current branch: ${currentBranch || 'unknown'}${isDisabled ? ' (disabled — uncommitted changes)' : ''}`}
        title={
          isDisabled
            ? 'Commit or stash changes before switching branches'
            : `Switch branch (current: ${currentBranch})`
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[1],
          padding: `2px ${tokens.space[2]}`,
          backgroundColor: tokens.color.surfaceHigh,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.sm,
          color: isDisabled ? tokens.color.textDim : tokens.color.text,
          fontSize: tokens.size.sm,
          fontFamily: tokens.font.ui,
          cursor: isDisabled ? 'not-allowed' : 'pointer'
        }}
      >
        <GitBranch size={14} />
        <span
          style={{
            maxWidth: '160px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {currentBranch || 'unknown'}
        </span>
        <ChevronDown size={12} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setIsOpen(false)}
          />
          <div
            role="listbox"
            aria-label="Branches"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 1000,
              minWidth: '180px',
              maxHeight: '240px',
              overflowY: 'auto',
              backgroundColor: tokens.color.surfaceHigh,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.md,
              boxShadow: tokens.shadow.md,
              marginTop: tokens.space[1]
            }}
          >
            {branches.length === 0 ? (
              <div
                style={{
                  padding: tokens.space[3],
                  color: tokens.color.textMuted,
                  fontSize: tokens.size.sm,
                  textAlign: 'center'
                }}
              >
                No branches found
              </div>
            ) : (
              branches.map((branch) => (
                <button
                  key={branch}
                  role="option"
                  aria-selected={branch === currentBranch}
                  onClick={() => handleSelect(branch)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[2],
                    width: '100%',
                    textAlign: 'left',
                    padding: `${tokens.space[1]} ${tokens.space[3]}`,
                    background: branch === currentBranch ? tokens.color.accentDim : 'none',
                    border: 'none',
                    color: branch === currentBranch ? tokens.color.accent : tokens.color.text,
                    fontSize: tokens.size.sm,
                    fontFamily: tokens.font.ui,
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    if (branch !== currentBranch) {
                      ;(e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        tokens.color.surfaceHigh
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (branch !== currentBranch) {
                      ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  <GitBranch size={12} />
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {branch}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default BranchSelector
