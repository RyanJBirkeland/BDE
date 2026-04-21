import { useEffect, useState, useMemo } from 'react'
import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'
import type { DiffFile } from '../stores/codeReview'
import type { ReviewDiffSnapshot } from '../../../shared/types'

function parseSnapshot(raw: string | null | undefined): ReviewDiffSnapshot | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReviewDiffSnapshot
  } catch {
    return null
  }
}

export interface ReviewChangesResult {
  files: DiffFile[]
  loading: boolean
  error: string | null
  isSnapshot: boolean
  snapshotCapturedAt: string | null
  snapshotTruncated: boolean
  fileDiff: string
  fileDiffLoading: boolean
  selectFile: (filePath: string) => void
}

export function useReviewChanges(taskId: string | null): ReviewChangesResult {
  const tasks = useSprintTasks((s) => s.tasks)
  const setDiffFiles = useCodeReviewStore((s) => s.setDiffFiles)
  const setLoading = useCodeReviewStore((s) => s.setLoading)
  const selectedDiffFile = useCodeReviewStore((s) => s.selectedDiffFile)
  const setSelectedDiffFile = useCodeReviewStore((s) => s.setSelectedDiffFile)

  const [fileDiff, setFileDiff] = useState<string>('')
  const [isSnapshot, setIsSnapshot] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const task = tasks.find((t) => t.id === taskId)

  const snapshot = useMemo(
    () => parseSnapshot(task?.review_diff_snapshot),
    [task?.review_diff_snapshot]
  )

  // Load file list on task selection
  useEffect(() => {
    let cancelled = false
    setLoading('diff', true)
    setError(null)

    const load = async (): Promise<void> => {
      // Reset snapshot flag — new task, fresh attempt
      if (!cancelled) setIsSnapshot(false)

      if (!task?.worktree_path) {
        if (!cancelled) {
          if (snapshot && snapshot.files.length > 0) {
            // Apply snapshot
            setIsSnapshot(true)
            setDiffFiles(
              snapshot.files.map((f) => ({
                path: f.path,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
                patch: f.patch ?? ''
              }))
            )
            const firstSnapshotFile = snapshot.files[0]
            if (firstSnapshotFile) {
              setSelectedDiffFile(firstSnapshotFile.path)
              setFileDiff(firstSnapshotFile.patch ?? '')
            }
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
        if (result.files.length > 0 && result.files[0]) setSelectedDiffFile(result.files[0].path)
      } catch (err) {
        if (cancelled) return
        if (snapshot && snapshot.files.length > 0) {
          // Fall back to snapshot
          setIsSnapshot(true)
          setDiffFiles(
            snapshot.files.map((f) => ({
              path: f.path,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch ?? ''
            }))
          )
          const firstSnapshotFile = snapshot.files[0]
          if (firstSnapshotFile) {
            setSelectedDiffFile(firstSnapshotFile.path)
            setFileDiff(firstSnapshotFile.patch ?? '')
          }
        } else {
          setDiffFiles([])
          setError(err instanceof Error ? err.message : 'Failed to load diff')
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
      if (isSnapshot) {
        const file = snapshot?.files.find((f) => f.path === selectedDiffFile)
        if (!cancelled) setFileDiff(file?.patch ?? '')
        return
      }
      if (!task?.worktree_path || !selectedDiffFile) return
      try {
        const result = await window.api.review.getFileDiff({
          worktreePath: task.worktree_path,
          filePath: selectedDiffFile,
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
  }, [task?.worktree_path, selectedDiffFile, isSnapshot, snapshot])

  return {
    files: useCodeReviewStore((s) => s.diffFiles),
    loading: useCodeReviewStore((s) => s.loading.diff ?? false),
    error,
    isSnapshot,
    snapshotCapturedAt: isSnapshot ? (snapshot?.capturedAt ?? null) : null,
    snapshotTruncated: isSnapshot ? (snapshot?.truncated ?? false) : false,
    fileDiff,
    fileDiffLoading: false, // Not tracking separate loading state for file diff
    selectFile: setSelectedDiffFile
  }
}
