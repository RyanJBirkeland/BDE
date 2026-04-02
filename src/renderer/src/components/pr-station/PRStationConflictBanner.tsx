import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { OpenPr } from '../../../../shared/types'
import { useRepoOptions } from '../../hooks/useRepoOptions'

interface ConflictBannerProps {
  pr: OpenPr
  mergeableState: string | null | undefined
}

export function PRStationConflictBanner({ pr, mergeableState }: ConflictBannerProps) {
  const repoOptions = useRepoOptions()
  const [conflictFiles, setConflictFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mergeableState !== 'dirty') {
      setConflictFiles([])
      setError(null)
      return
    }

    const repo = repoOptions.find((r) => r.label === pr.repo)
    if (!repo) return

    setLoading(true)
    setError(null)
    window.api
      .checkConflictFiles({ owner: repo.owner, repo: repo.label, prNumber: pr.number })
      .then((result) => {
        setConflictFiles(result.files)
        setError(null)
      })
      .catch((err) => {
        setConflictFiles([])
        setError(err instanceof Error ? err.message : 'Failed to fetch conflict files')
      })
      .finally(() => setLoading(false))
  }, [pr.repo, pr.number, mergeableState, repoOptions])

  if (mergeableState !== 'dirty') return null

  return (
    <div className="pr-conflict-banner">
      <div className="pr-conflict-banner__header">
        <AlertTriangle size={14} />
        <span>This PR has merge conflicts</span>
      </div>
      {loading ? (
        <span className="pr-conflict-banner__loading">Checking conflicting files...</span>
      ) : error ? (
        <span className="pr-conflict-banner__error" style={{ color: 'var(--color-text-tertiary)' }}>
          {error}
        </span>
      ) : conflictFiles.length > 0 ? (
        <ul className="pr-conflict-banner__files">
          {conflictFiles.map((f) => (
            <li key={f} className="pr-conflict-banner__file">
              {f}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
