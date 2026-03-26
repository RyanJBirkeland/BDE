import { useState, useCallback, useEffect } from 'react'
import { mergePR } from '../../lib/github-api'
import type { OpenPr, PrListPayload } from '../../../../shared/types'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { ErrorBanner } from '../ui/ErrorBanner'
import { REPO_OPTIONS } from '../../lib/constants'
import { timeAgo, repoColor } from '../../lib/format'
import { PRStationDiff } from '../pr-station/PRStationDiff'

// PRList excludes BDE (this app) — only show external repos
const EXCLUDED_REPO = 'BDE'

export function PRList() {
  const [prs, setPrs] = useState<OpenPr[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<number | null>(null)
  const [confirmMerge, setConfirmMerge] = useState<OpenPr | null>(null)
  const [mergeability, setMergeability] = useState<Record<string, string | undefined>>({})
  const [diffPrKey, setDiffPrKey] = useState<string | null>(null)

  const applyPayload = useCallback((payload: PrListPayload) => {
    const filtered = payload.prs.filter((p) => p.repo !== EXCLUDED_REPO)
    setPrs(filtered)
    setError(null)
    setLoading(false)

    // Derive mergeability from check data (checks include mergeable_state if available)
    // The main-process poller doesn't fetch per-PR mergeability, but the check-runs data
    // is sufficient for CI status. Mergeability comes from the sprint task PR poller.
    // We no longer need a separate mergeability poll here.
    const mMap: Record<string, string | undefined> = {}
    for (const pr of filtered) {
      const key = `${pr.repo}-${pr.number}`
      // The check data doesn't have mergeable_state, so we leave this empty
      // Conflict detection is handled by the sprint PR status poller
      mMap[key] = undefined
    }
    setMergeability(mMap)
  }, [])

  // Subscribe to main-process push events
  useEffect(() => {
    window.api.getPrList().then(applyPayload)
    return window.api.onPrListUpdated(applyPayload)
  }, [applyPayload])

  const handleRefresh = useCallback(() => {
    setLoading(true)
    window.api.refreshPrList().then(applyPayload)
  }, [applyPayload])

  const handleMerge = async (pr: OpenPr) => {
    const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)
    if (!repo) return
    setMerging(pr.number)
    try {
      await mergePR(repo.owner, repo.label, pr.number)
      setPrs((prev) => prev.filter((p) => !(p.number === pr.number && p.repo === pr.repo)))
      toast.success(`Merged #${pr.number} successfully`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setMerging(null)
      setConfirmMerge(null)
    }
  }

  return (
    <div className="pr-list">
      <div className="pr-list__header">
        <span className="pr-list__title">Open Pull Requests</span>
        <span className="pr-list__count bde-count-badge">{prs.length}</span>
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

      <ErrorBanner message={error} className="sprint-board__error" />

      <div className="pr-list__rows">
        {loading && prs.length === 0 ? (
          <div className="sprint-board__loading">
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
          </div>
        ) : prs.length === 0 ? (
          <EmptyState title="No open PRs" />
        ) : (
          prs.map((pr, i) => {
            const hasConflicts = mergeability[`${pr.repo}-${pr.number}`] === 'dirty'
            const prKey = `${pr.repo}-${pr.number}`
            return (
              <div key={prKey}>
                <div
                  className={`pr-row ${hasConflicts ? 'pr-row--conflicts' : ''}`}
                  style={{ '--stagger-index': Math.min(i, 10) } as React.CSSProperties}
                >
                  <span
                    className="pr-row__repo-dot"
                    style={{ background: repoColor(pr.repo) }}
                    title={pr.repo}
                  />
                  {hasConflicts && (
                    <span className="pr-row__conflict-dot" title="Has merge conflicts" />
                  )}
                  <div className="pr-row__info">
                    <span className="pr-row__title">{pr.title}</span>
                    <span className="pr-row__meta">
                      {pr.repo} #{pr.number} &middot; {timeAgo(pr.updated_at)}
                      {hasConflicts && (
                        <span className="pr-row__conflict-label"> &middot; conflicts</span>
                      )}
                    </span>
                  </div>
                  <div className="pr-row__actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="pr-row__btn"
                      onClick={() => setDiffPrKey(diffPrKey === prKey ? null : prKey)}
                    >
                      {diffPrKey === prKey ? 'Hide Diff' : 'Diff'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="pr-row__btn pr-row__btn--open"
                      onClick={() => window.api.openExternal(pr.html_url)}
                    >
                      Open
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="pr-row__btn pr-row__btn--merge"
                      disabled={merging === pr.number}
                      onClick={() => setConfirmMerge(pr)}
                    >
                      {merging === pr.number ? '...' : 'Merge'}
                    </Button>
                  </div>
                </div>
                {diffPrKey === prKey && <PRStationDiff pr={pr} />}
              </div>
            )
          })
        )}
      </div>

      {confirmMerge && (
        <div className="pr-confirm-overlay" onClick={() => setConfirmMerge(null)}>
          <div
            className="pr-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="pr-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pr-confirm__title" id="pr-confirm-title">
              Squash merge this PR?
            </p>
            <p className="pr-confirm__detail">
              #{confirmMerge.number} &mdash; {confirmMerge.title}
            </p>
            <div className="pr-confirm__actions">
              <Button variant="ghost" size="sm" onClick={() => setConfirmMerge(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={merging === confirmMerge.number}
                onClick={() => handleMerge(confirmMerge)}
              >
                {merging === confirmMerge.number ? 'Merging...' : 'Confirm Merge'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
