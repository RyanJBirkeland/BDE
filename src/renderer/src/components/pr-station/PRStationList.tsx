import { useState, useCallback, useRef, useEffect } from 'react'
import { CircleCheck, CircleX, Clock, FileCode2 } from 'lucide-react'
import {
  listOpenPRs,
  getCheckRuns,
  type PullRequest,
  type CheckRunSummary
} from '../../lib/github-api'
import { POLL_PR_LIST_INTERVAL, REPO_OPTIONS } from '../../lib/constants'
import { timeAgo } from '../../lib/format'
import { EmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'

interface PRStationListProps {
  selectedPr: PullRequest | null
  onSelectPr: (pr: PullRequest) => void
}

const REPO_COLOR: Record<string, string> = Object.fromEntries(
  REPO_OPTIONS.map((r) => [r.label, r.color])
)

function CIBadge({ summary }: { summary: CheckRunSummary | undefined }) {
  if (!summary || summary.total === 0) {
    return <span className="pr-station__ci pr-station__ci--none" title="No checks">—</span>
  }
  if (summary.status === 'pass') {
    return (
      <span className="pr-station__ci pr-station__ci--pass" title={`${summary.passed}/${summary.total} passed`}>
        <CircleCheck size={14} />
      </span>
    )
  }
  if (summary.status === 'fail') {
    return (
      <span className="pr-station__ci pr-station__ci--fail" title={`${summary.failed} failed, ${summary.passed} passed`}>
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

export function PRStationList({ selectedPr, onSelectPr }: PRStationListProps) {
  const [prs, setPrs] = useState<PullRequest[]>([])
  const [checks, setChecks] = useState<Record<string, CheckRunSummary>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchChecks = useCallback(async (prList: PullRequest[]) => {
    const results = await Promise.all(
      prList.map(async (pr) => {
        const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)
        if (!repo) return null
        try {
          const summary = await getCheckRuns(repo.owner, repo.label, pr.head.sha)
          return { key: `${pr.repo}-${pr.number}`, summary }
        } catch {
          return null
        }
      })
    )
    const map: Record<string, CheckRunSummary> = {}
    for (const r of results) {
      if (r) map[r.key] = r.summary
    }
    setChecks(map)
  }, [])

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        REPO_OPTIONS.map((r) =>
          listOpenPRs(r.owner, r.label).catch(() => [] as PullRequest[])
        )
      )
      const all = results
        .flat()
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      setPrs(all)
      setError(null)
      fetchChecks(all)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PRs')
    } finally {
      setLoading(false)
    }
  }, [fetchChecks])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, POLL_PR_LIST_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  return (
    <div className="pr-station-list">
      <div className="pr-station-list__header">
        <span className="pr-station-list__title">Open PRs</span>
        <span className="pr-station-list__count bde-count-badge">{prs.length}</span>
        <Button variant="icon" size="sm" onClick={load} disabled={loading} title="Refresh">
          &#x21bb;
        </Button>
      </div>

      {error && <div className="bde-error-banner">{error}</div>}

      <div className="pr-station-list__rows">
        {loading && prs.length === 0 ? (
          <div className="pr-station-list__loading">
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
          </div>
        ) : prs.length === 0 ? (
          <EmptyState icon={<FileCode2 size={24} />} title="No open PRs" description="All clear across repos" />
        ) : (
          prs.map((pr) => {
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
                    style={{ background: REPO_COLOR[pr.repo] ?? 'var(--bde-text-dim)' }}
                  >
                    {pr.repo}
                  </span>
                  <span className="pr-station-list__number">#{pr.number}</span>
                  {pr.draft && <span className="pr-station-list__draft">draft</span>}
                  <CIBadge summary={checks[`${pr.repo}-${pr.number}`]} />
                </div>
                <div className="pr-station-list__title-text">{pr.title}</div>
                <div className="pr-station-list__meta">
                  <span className="pr-station-list__diff">
                    <span className="pr-station-list__additions">+{pr.additions}</span>
                    <span className="pr-station-list__deletions">-{pr.deletions}</span>
                  </span>
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
