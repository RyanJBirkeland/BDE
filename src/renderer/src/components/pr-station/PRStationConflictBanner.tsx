import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { OpenPr } from '../../../../shared/types'
import { REPO_OPTIONS } from '../../lib/constants'

interface ConflictBannerProps {
  pr: OpenPr
  mergeableState: string | null | undefined
}

export function PRStationConflictBanner({ pr, mergeableState }: ConflictBannerProps) {
  const [conflictFiles, setConflictFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (mergeableState !== 'dirty') {
      setConflictFiles([])
      return
    }

    const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)
    if (!repo) return

    setLoading(true)
    window.api
      .checkConflictFiles({ owner: repo.owner, repo: repo.label, prNumber: pr.number })
      .then((result) => {
        setConflictFiles(result.files)
      })
      .catch(() => {
        setConflictFiles([])
      })
      .finally(() => setLoading(false))
  }, [pr.repo, pr.number, mergeableState])

  if (mergeableState !== 'dirty') return null

  return (
    <div className="pr-conflict-banner">
      <div className="pr-conflict-banner__header">
        <AlertTriangle size={14} />
        <span>This PR has merge conflicts</span>
      </div>
      {loading ? (
        <span className="pr-conflict-banner__loading">Checking conflicting files...</span>
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
