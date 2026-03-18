import { useEffect, useState } from 'react'
import { getPRDiff } from '../../lib/github-api'
import type { OpenPr } from '../../../../shared/types'
import { parseDiff, type DiffFile } from '../../lib/diff-parser'
import { REPO_OPTIONS } from '../../lib/constants'
import DiffViewer from '../diff/DiffViewer'

export function PRStationDiff({ pr }: { pr: OpenPr }) {
  const [files, setFiles] = useState<DiffFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const repoOption = REPO_OPTIONS.find((r) => r.label === pr.repo)
    if (!repoOption) {
      setError('Unknown repo')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getPRDiff(repoOption.owner, repoOption.label, pr.number)
      .then((raw) => {
        if (!cancelled) setFiles(parseDiff(raw))
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load diff')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [pr.repo, pr.number])

  if (loading) {
    return (
      <div className="pr-station__diff-loading">
        <div className="sprint-board__skeleton" />
        <div className="sprint-board__skeleton" />
      </div>
    )
  }

  if (error) return <div className="bde-error-banner">{error}</div>

  const totalAdded = files.reduce((s, f) => s + f.additions, 0)
  const totalDeleted = files.reduce((s, f) => s + f.deletions, 0)

  return (
    <div className="pr-station__diff">
      <div className="pr-station__diff-header">
        <span>{files.length} files changed</span>
        <span className="pr-station-list__additions">+{totalAdded}</span>
        <span className="pr-station-list__deletions">-{totalDeleted}</span>
      </div>
      <DiffViewer files={files} />
    </div>
  )
}
