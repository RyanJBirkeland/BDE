import { useState, useCallback, useEffect, useMemo } from 'react'
import { CircleCheck, CircleX, Clock, FileCode2 } from 'lucide-react'
import type { OpenPr, CheckRunSummary, PrListPayload } from '../../../../shared/types'
import { EmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'
import { timeAgo } from '../../lib/format'
import { useRepoOptions } from '../../hooks/useRepoOptions'

interface PRStationListProps {
  selectedPr: OpenPr | null
  onSelectPr: (pr: OpenPr) => void
  removedKeys?: Set<string>
  /** When provided, overrides internal PR list (used by parent for filtering/sorting) */
  prs?: OpenPr[]
  onPrsChange?: (prs: OpenPr[]) => void
}

function CIBadge({ summary }: { summary: CheckRunSummary | undefined }) {
  if (!summary || summary.total === 0) {
    return (
      <span className="pr-station__ci pr-station__ci--none" title="No checks">
        —
      </span>
    )
  }
  if (summary.status === 'pass') {
    return (
      <span
        className="pr-station__ci pr-station__ci--pass"
        title={`${summary.passed}/${summary.total} passed`}
      >
        <CircleCheck size={14} />
      </span>
    )
  }
  if (summary.status === 'fail') {
    return (
      <span
        className="pr-station__ci pr-station__ci--fail"
        title={`${summary.failed} failed, ${summary.passed} passed`}
      >
        <CircleX size={14} />
      </span>
    )
  }
  return (
    <span className="pr-station__ci pr-station__ci--pending" title={`${summary.pending} pending`}>
      <Clock size={14} />
    </span>
  )
}

export function PRStationList({
  selectedPr,
  onSelectPr,
  removedKeys,
  prs: externalPrs,
  onPrsChange
}: PRStationListProps) {
  const repoOptions = useRepoOptions()
  const [internalPrs, setInternalPrs] = useState<OpenPr[]>([])
  const [checks, setChecks] = useState<Record<string, CheckRunSummary>>({})
  const [loading, setLoading] = useState(true)

  const prs = externalPrs ?? internalPrs

  const repoColorMap = useMemo(
    () => Object.fromEntries(repoOptions.map((r) => [r.label, r.color])),
    [repoOptions]
  )

  const applyPayload = useCallback(
    (payload: PrListPayload) => {
      setInternalPrs(payload.prs)
      onPrsChange?.(payload.prs)
      setChecks(payload.checks)
      setLoading(false)
    },
    [onPrsChange]
  )

  // Subscribe to main-process push events
  useEffect(() => {
    // Seed with latest cached data
    window.api.getPrList().then(applyPayload)
    // Listen for future updates
    return window.api.onPrListUpdated(applyPayload)
  }, [applyPayload])

  const handleRefresh = useCallback(() => {
    setLoading(true)
    window.api.refreshPrList().then(applyPayload)
  }, [applyPayload])

  return (
    <div className="pr-station-list">
      <div className="pr-station-list__header">
        <span className="pr-station-list__title">Open PRs</span>
        <span className="pr-station-list__count bde-count-badge">
          {prs.filter((p) => !removedKeys?.has(`${p.repo}-${p.number}`)).length}
        </span>
        <Button
          variant="icon"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
        >
          &#x21bb;
        </Button>
      </div>

      <div className="pr-station-list__rows">
        {loading && prs.length === 0 ? (
          <div className="pr-station-list__loading">
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
          </div>
        ) : prs.filter((p) => !removedKeys?.has(`${p.repo}-${p.number}`)).length === 0 ? (
          <EmptyState
            icon={<FileCode2 size={24} />}
            title="No open PRs"
            description="All clear across repos"
          />
        ) : (
          prs
            .filter((p) => !removedKeys?.has(`${p.repo}-${p.number}`))
            .map((pr) => {
              const isSelected = selectedPr?.number === pr.number && selectedPr?.repo === pr.repo
              return (
                <button
                  key={`${pr.repo}-${pr.number}`}
                  className={`pr-station-list__row${isSelected ? ' pr-station-list__row--selected' : ''}`}
                  onClick={() => onSelectPr(pr)}
                >
                  <div className="pr-station-list__row-top">
                    <span
                      className="pr-station-list__repo-badge"
                      style={{ background: repoColorMap[pr.repo] ?? 'var(--neon-text-dim)' }}
                    >
                      {pr.repo}
                    </span>
                    <span className="pr-station-list__number">#{pr.number}</span>
                    {pr.draft && <span className="pr-station-list__draft">draft</span>}
                    <CIBadge summary={checks[`${pr.repo}-${pr.number}`]} />
                  </div>
                  <div className="pr-station-list__title-text">{pr.title}</div>
                  <div className="pr-station-list__meta">
                    <span className="pr-station-list__time">{timeAgo(pr.updated_at)}</span>
                  </div>
                </button>
              )
            })
        )}
      </div>
    </div>
  )
}
