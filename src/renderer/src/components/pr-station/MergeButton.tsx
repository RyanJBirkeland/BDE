import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, GitMerge } from 'lucide-react'
import { mergePR, type MergeMethod, type PrMergeability } from '../../lib/github-api'
import type { OpenPr } from '../../../../shared/types'
import { toast } from '../../stores/toasts'
import { REPO_OPTIONS } from '../../lib/constants'

interface MergeButtonProps {
  pr: OpenPr
  mergeability: PrMergeability | null
  onMerged?: (pr: OpenPr) => void
}

const MERGE_STRATEGIES: { value: MergeMethod; label: string }[] = [
  { value: 'squash', label: 'Squash' },
  { value: 'merge', label: 'Merge commit' },
  { value: 'rebase', label: 'Rebase' }
]

export function MergeButton({ pr, mergeability, onMerged }: MergeButtonProps) {
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [merging, setMerging] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isMergeable = mergeability?.mergeable === true
  const mergeBlocked = mergeability !== null && !isMergeable
  const disabled = mergeBlocked || merging || pr.merged === true

  const closeDropdown = useCallback(() => setDropdownOpen(false), [])

  useEffect(() => {
    if (!dropdownOpen) return
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [dropdownOpen, closeDropdown])

  // Reset state when PR changes
  useEffect(() => {
    setDropdownOpen(false)
    setMerging(false)
  }, [pr.number, pr.repo])

  async function handleMerge() {
    const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)
    if (!repo) return
    setMerging(true)
    try {
      await mergePR(repo.owner, repo.label, pr.number, method)
      toast.success(`Merged: ${pr.title}`)
      onMerged?.(pr)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  const strategyLabel = MERGE_STRATEGIES.find((s) => s.value === method)!.label
  const mergeTitle = mergeBlocked
    ? `Not mergeable (${mergeability?.mergeable_state})`
    : merging
      ? 'Merging…'
      : `${strategyLabel} merge`

  return (
    <div className="merge-button" ref={dropdownRef}>
      <button
        className="merge-button__action bde-btn bde-btn--sm bde-btn--primary"
        onClick={handleMerge}
        disabled={disabled}
        title={mergeTitle}
        aria-label={mergeTitle}
      >
        <GitMerge size={13} aria-hidden="true" />
        {merging ? 'Merging…' : strategyLabel}
      </button>
      <button
        className="merge-button__dropdown-trigger bde-btn bde-btn--sm bde-btn--primary"
        onClick={() => setDropdownOpen((o) => !o)}
        disabled={disabled}
        title="Pick merge strategy"
        aria-label="Pick merge strategy"
        aria-expanded={dropdownOpen}
        aria-haspopup="listbox"
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {dropdownOpen && (
        <div className="merge-button__dropdown" role="listbox" aria-label="Merge strategy">
          {MERGE_STRATEGIES.map((s) => (
            <button
              key={s.value}
              role="option"
              aria-selected={s.value === method}
              className={`merge-button__dropdown-item${s.value === method ? ' merge-button__dropdown-item--active' : ''}`}
              onClick={() => {
                setMethod(s.value)
                setDropdownOpen(false)
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
