import { useEffect, useState, useMemo } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { Plus, Minus, Edit2 } from 'lucide-react'
import { parseDiff } from '../../lib/diff-parser'
import { DiffViewer } from '../diff/DiffViewer'
import { EmptyState } from '../ui/EmptyState'
import type { ReviewDiffSnapshot } from '../../../../shared/types'

function parseSnapshot(raw: string | null | undefined): ReviewDiffSnapshot | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReviewDiffSnapshot
  } catch {
    return null
  }
}

export function ChangesTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const diffFiles = useCodeReviewStore((s) => s.diffFiles)
  const setDiffFiles = useCodeReviewStore((s) => s.setDiffFiles)
  const setLoading = useCodeReviewStore((s) => s.setLoading)
  const loading = useCodeReviewStore((s) => s.loading)
  const tasks = useSprintTasks((s) => s.tasks)

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<string>('')

  const task = tasks.find((t) => t.id === selectedTaskId)

  const snapshot = useMemo(
    () => parseSnapshot(task?.review_diff_snapshot),
    [task?.review_diff_snapshot]
  )
  const [usingSnapshot, setUsingSnapshot] = useState(false)

  // Helper — install the archived snapshot as the current file list.
  const applySnapshot = (snap: ReviewDiffSnapshot): void => {
    setUsingSnapshot(true)
    setDiffFiles(
      snap.files.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? ''
      }))
    )
    setSelectedFile(snap.files[0].path)
    setFileDiff(snap.files[0].patch ?? '')
  }

  // Load file list on task selection
  useEffect(() => {
    let cancelled = false
    setLoading('diff', true)
    const load = async (): Promise<void> => {
      // Reset the snapshot flag first — new task, fresh attempt.
      if (!cancelled) setUsingSnapshot(false)

      if (!task?.worktree_path) {
        if (!cancelled) {
          if (snapshot && snapshot.files.length > 0) {
            applySnapshot(snapshot)
          } else {
            setDiffFiles([])
          }
        }
        return
      }

      try {
        const result = await window.api.review.getDiff({
          worktreePath: task.worktree_path,
          base: 'origin/main'
        })
        if (cancelled) return
        setDiffFiles(result.files)
        if (result.files.length > 0) setSelectedFile(result.files[0].path)
      } catch {
        if (cancelled) return
        if (snapshot && snapshot.files.length > 0) {
          applySnapshot(snapshot)
        } else {
          setDiffFiles([])
        }
      }
    }
    load().finally(() => {
      if (!cancelled) setLoading('diff', false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.worktree_path, task?.id, snapshot])

  // Load file diff when selection changes
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (usingSnapshot) {
        const file = snapshot?.files.find((f) => f.path === selectedFile)
        if (!cancelled) setFileDiff(file?.patch ?? '')
        return
      }
      if (!task?.worktree_path || !selectedFile) return
      try {
        const result = await window.api.review.getFileDiff({
          worktreePath: task.worktree_path,
          filePath: selectedFile,
          base: 'origin/main'
        })
        if (!cancelled) setFileDiff(result.diff)
      } catch {
        if (!cancelled) setFileDiff('Failed to load diff')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [task?.worktree_path, selectedFile, usingSnapshot, snapshot])

  // Parse the raw diff text into structured format for DiffViewer
  // Must be called before early returns (React Hooks rule)
  const parsedDiff = useMemo(() => {
    if (!fileDiff) return []
    return parseDiff(fileDiff)
  }, [fileDiff])

  if (loading.diff) {
    return (
      <div className="cr-changes">
        <div
          className="cr-changes__files"
          style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8 }}
        >
          <div className="bde-skeleton" style={{ height: 28 }} />
          <div className="bde-skeleton" style={{ height: 28 }} />
          <div className="bde-skeleton" style={{ height: 28 }} />
        </div>
        <div className="cr-changes__diff" style={{ padding: 16 }}>
          <div className="bde-skeleton" style={{ height: 200 }} />
        </div>
      </div>
    )
  }

  if (diffFiles.length === 0) {
    return (
      <div className="cr-changes">
        <EmptyState message="No changes found in this branch." />
      </div>
    )
  }

  const statusIcon = (status: string): React.JSX.Element => {
    if (status === 'A' || status === 'added') return <Plus size={12} className="cr-file-added" />
    if (status === 'D' || status === 'deleted')
      return <Minus size={12} className="cr-file-deleted" />
    return <Edit2 size={12} className="cr-file-modified" />
  }

  return (
    <div className="cr-changes" data-testid="cr-changes">
      {usingSnapshot && (
        <div
          data-testid="cr-changes-snapshot-banner"
          style={{
            gridColumn: '1 / -1',
            fontSize: 11,
            padding: '6px 10px',
            background: 'var(--bde-surface-raised, rgba(255,255,255,0.04))',
            borderBottom: '1px solid var(--bde-border, rgba(255,255,255,0.08))',
            color: 'var(--bde-text-dim, rgba(255,255,255,0.6))'
          }}
          title={snapshot?.capturedAt ?? ''}
        >
          Worktree no longer available — showing archived snapshot
          {snapshot?.truncated ? ' (file stats only — diff was too large to preserve)' : ''}
        </div>
      )}
      <div className="cr-changes__files">
        {diffFiles.map((file) => (
          <button
            key={file.path}
            className={`cr-changes__file${file.path === selectedFile ? ' cr-changes__file--selected' : ''}`}
            onClick={() => setSelectedFile(file.path)}
          >
            {statusIcon(file.status)}
            <span className="cr-changes__file-path">{file.path}</span>
            <span className="cr-changes__file-stats">
              +{file.additions} -{file.deletions}
            </span>
          </button>
        ))}
      </div>
      <div className="cr-changes__diff">
        {fileDiff ? (
          <DiffViewer files={parsedDiff} />
        ) : (
          <div className="cr-placeholder">Select a file to view diff</div>
        )}
      </div>
    </div>
  )
}
