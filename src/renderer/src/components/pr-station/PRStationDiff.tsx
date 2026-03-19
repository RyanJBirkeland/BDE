import { useEffect, useRef, useState } from 'react'
import { getPRDiff } from '../../lib/github-api'
import type { OpenPr } from '../../../../shared/types'
import { parseDiffChunked, type DiffFile } from '../../lib/diff-parser'
import { REPO_OPTIONS, DIFF_SIZE_WARN_BYTES } from '../../lib/constants'
import { ErrorBanner } from '../ui/ErrorBanner'
import { DiffViewer } from '../diff/DiffViewer'
import { DiffSizeWarning } from '../diff/DiffSizeWarning'

export function PRStationDiff({ pr }: { pr: OpenPr }) {
  const [files, setFiles] = useState<DiffFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sizeWarning, setSizeWarning] = useState<number | null>(null)
  const rawRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadDiff = (raw: string): void => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    parseDiffChunked(raw, setFiles, controller.signal)
      .then(() => { setLoading(false) })
      .catch((e) => { if (e?.name !== 'AbortError') setLoading(false) })
  }

  useEffect(() => {
    const repoOption = REPO_OPTIONS.find((r) => r.label === pr.repo)
    if (!repoOption) {
      setError('Unknown repo')
      setLoading(false)
      return
    }
    let cancelled = false
    abortRef.current?.abort()
    setLoading(true)
    setError(null)
    setSizeWarning(null)
    rawRef.current = null

    getPRDiff(repoOption.owner, repoOption.label, pr.number)
      .then((raw) => {
        if (cancelled) return
        rawRef.current = raw

        if (raw.length > DIFF_SIZE_WARN_BYTES) {
          setSizeWarning(raw.length)
          setLoading(false)
          return
        }

        loadDiff(raw)
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof DOMException && e.name === 'AbortError')) {
          setError(e instanceof Error ? e.message : 'Failed to load diff')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [pr.repo, pr.number])

  const handleLoadAnyway = (): void => {
    setSizeWarning(null)
    setLoading(true)
    if (rawRef.current) loadDiff(rawRef.current)
  }

  if (loading) {
    return (
      <div className="pr-station__diff-loading">
        <div className="sprint-board__skeleton" />
        <div className="sprint-board__skeleton" />
      </div>
    )
  }

  if (error) return <ErrorBanner message={error} />

  if (sizeWarning) {
    return <DiffSizeWarning sizeBytes={sizeWarning} onLoadAnyway={handleLoadAnyway} />
  }

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
