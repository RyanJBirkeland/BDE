import React, { useState, useEffect, useRef, useCallback } from 'react'
import { GitBranch, ChevronDown } from 'lucide-react'

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
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  // Auto-focus first option when dropdown opens
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const firstOption = dropdownRef.current.querySelector<HTMLButtonElement>('[role="option"]')
      firstOption?.focus()
    }
  }, [isOpen])

  // Keyboard navigation for dropdown
  const handleDropdownKeyDown = useCallback((e: React.KeyboardEvent) => {
    const dropdown = dropdownRef.current
    if (!dropdown) return
    const items = Array.from(dropdown.querySelectorAll<HTMLElement>('[role="option"]'))
    const currentIndex = items.indexOf(e.target as HTMLElement)

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
        items[next]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
        items[prev]?.focus()
        break
      }
      case 'Enter':
      case ' ':
        e.preventDefault()
        ;(e.target as HTMLElement).click()
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
    }
  }, [])

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') setIsOpen(false)
  }

  return (
    <div className="git-branch-selector" onKeyDown={handleKeyDown}>
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
        className={`git-branch-selector__trigger ${isDisabled ? 'git-branch-selector__trigger--disabled' : 'git-branch-selector__trigger--enabled'}`}
      >
        <GitBranch size={14} />
        <span className="git-branch-selector__current" title={currentBranch || 'unknown'}>
          {currentBranch || 'unknown'}
        </span>
        <ChevronDown size={12} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <div className="git-branch-selector__backdrop" onClick={() => setIsOpen(false)} />
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label="Branches"
            className="git-branch-selector__dropdown"
            onKeyDown={handleDropdownKeyDown}
          >
            {branches.length === 0 ? (
              <div className="git-branch-selector__empty">No branches found</div>
            ) : (
              branches.map((branch) => (
                <button
                  key={branch}
                  role="option"
                  tabIndex={-1}
                  aria-selected={branch === currentBranch}
                  onClick={() => handleSelect(branch)}
                  className={`git-branch-selector__option ${branch === currentBranch ? 'git-branch-selector__option--current' : ''}`}
                >
                  <GitBranch size={12} />
                  <span className="git-branch-selector__option-name">{branch}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
