import { useState, useCallback, useRef, useEffect } from 'react'
import { listOpenPRs, mergePR, type PullRequest } from '../../lib/github-api'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { POLL_PR_LIST_INTERVAL, REPO_OPTIONS } from '../../lib/constants'
import { timeAgo } from '../../lib/format'

// PRList excludes BDE (this app) — only show external repos
const PR_REPOS = REPO_OPTIONS.filter((r) => r.label !== 'BDE')

export default function PRList() {
  const [prs, setPrs] = useState<PullRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<number | null>(null)
  const [confirmMerge, setConfirmMerge] = useState<PullRequest | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        PR_REPOS.map((r) => listOpenPRs(r.owner, r.label).catch(() => [] as PullRequest[]))
      )
      const all = results
        .flat()
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      setPrs(all)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PRs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, POLL_PR_LIST_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  const handleMerge = async (pr: PullRequest) => {
    const repo = PR_REPOS.find((r) => r.label === pr.repo)
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

  const repoColor = (repoName: string) =>
    PR_REPOS.find((r) => r.label === repoName)?.color ?? 'var(--bde-text-dim)'

  return (
    <div className="pr-list">
      <div className="pr-list__header">
        <span className="pr-list__title">Open Pull Requests</span>
        <span className="pr-list__count bde-count-badge">{prs.length}</span>
        <Button variant="icon" size="sm" onClick={load} disabled={loading} title="Refresh">
          &#x21bb;
        </Button>
      </div>

      {error && <div className="sprint-board__error bde-error-banner">{error}</div>}

      <div className="pr-list__rows">
        {loading && prs.length === 0 ? (
          <div className="sprint-board__loading">
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
          </div>
        ) : prs.length === 0 ? (
          <EmptyState title="No open PRs" />
        ) : (
          prs.map((pr, i) => (
            <div key={`${pr.repo}-${pr.number}`} className="pr-row" style={{ '--stagger-index': Math.min(i, 10) } as React.CSSProperties}>
              <span
                className="pr-row__repo-dot"
                style={{ background: repoColor(pr.repo) }}
                title={pr.repo}
              />
              <div className="pr-row__info">
                <span className="pr-row__title">{pr.title}</span>
                <span className="pr-row__meta">
                  {pr.repo} #{pr.number} &middot; {timeAgo(pr.updated_at)}
                  {pr.additions !== undefined && ` \u00B7 +${pr.additions} -${pr.deletions}`}
                </span>
              </div>
              <div className="pr-row__actions">
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
          ))
        )}
      </div>

      {confirmMerge && (
        <div className="pr-confirm-overlay" onClick={() => setConfirmMerge(null)}>
          <div className="pr-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="pr-confirm__title">Squash merge this PR?</p>
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
