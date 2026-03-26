import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, GitMerge, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { mergePR, closePR, type MergeMethod, type PrMergeability } from '../../lib/github-api'
import type { OpenPr } from '../../../../shared/types'
import { toast } from '../../stores/toasts'
import { REPO_OPTIONS } from '../../lib/constants'

interface PRStationActionsProps {
  pr: OpenPr
  mergeability: PrMergeability | null
  onRemovePr: (pr: OpenPr) => void
}

const MERGE_STRATEGIES: { value: MergeMethod; label: string }[] = [
  { value: 'squash', label: 'Squash' },
  { value: 'merge', label: 'Merge commit' },
  { value: 'rebase', label: 'Rebase' }
]

type ConfirmAction = 'merge' | 'close' | null

export function PRStationActions({ pr, mergeability, onRemovePr }: PRStationActionsProps) {
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isMerged = pr.merged === true
  const isMergeable = mergeability?.mergeable === true
  const mergeBlocked = mergeability !== null && !isMergeable

  const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)

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

  useEffect(() => {
    setConfirmAction(null)
    setDropdownOpen(false)
  }, [pr.number, pr.repo])

  async function handleMerge() {
    if (!repo) return
    setLoading(true)
    try {
      await mergePR(repo.owner, repo.label, pr.number, method)
      toast.success(`Merged: ${pr.title}`)
      onRemovePr(pr)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setLoading(false)
      setConfirmAction(null)
    }
  }

  async function handleClose() {
    if (!repo) return
    setLoading(true)
    try {
      await closePR(repo.owner, repo.label, pr.number)
      toast.success(`Closed: ${pr.title}`)
      onRemovePr(pr)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Close failed')
    } finally {
      setLoading(false)
      setConfirmAction(null)
    }
  }

  if (isMerged) {
    return (
      <div className="pr-actions">
        <span className="pr-actions__merged-badge">
          <GitMerge size={14} />
          Merged
        </span>
      </div>
    )
  }

  const strategyLabel = MERGE_STRATEGIES.find((s) => s.value === method)!.label

  if (confirmAction === 'merge') {
    return (
      <div className="pr-actions pr-actions--confirm">
        <span className="pr-actions__confirm-text">
          {strategyLabel} merge PR #{pr.number}?
        </span>
        <Button variant="primary" size="sm" onClick={handleMerge} loading={loading}>
          Confirm
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)} disabled={loading}>
          Cancel
        </Button>
      </div>
    )
  }

  if (confirmAction === 'close') {
    return (
      <div className="pr-actions pr-actions--confirm">
        <span className="pr-actions__confirm-text">Close PR #{pr.number}?</span>
        <Button variant="danger" size="sm" onClick={handleClose} loading={loading}>
          Confirm
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)} disabled={loading}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="pr-actions">
      <div className="pr-actions__merge-group" ref={dropdownRef}>
        <Button
          variant="primary"
          size="sm"
          disabled={mergeBlocked}
          onClick={() => setConfirmAction('merge')}
          title={
            mergeBlocked
              ? `Not mergeable (${mergeability?.mergeable_state})`
              : `${strategyLabel} merge`
          }
        >
          <GitMerge size={14} />
          {strategyLabel}
        </Button>
        <button
          className="pr-actions__dropdown-trigger"
          onClick={() => setDropdownOpen((o) => !o)}
          disabled={mergeBlocked}
          title="Pick merge strategy"
        >
          <ChevronDown size={14} />
        </button>
        {dropdownOpen && (
          <div className="pr-actions__dropdown">
            {MERGE_STRATEGIES.map((s) => (
              <button
                key={s.value}
                className={`pr-actions__dropdown-item${s.value === method ? ' pr-actions__dropdown-item--active' : ''}`}
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

      <Button variant="danger" size="sm" onClick={() => setConfirmAction('close')} title="Close PR">
        <X size={14} />
        Close
      </Button>
    </div>
  )
}
