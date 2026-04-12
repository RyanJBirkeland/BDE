import './ChangesTab.css'
import { useMemo } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { parseDiff } from '../../lib/diff-parser'
import { DiffViewer } from '../diff/DiffViewer'
import { EmptyState } from '../ui/EmptyState'
import { useReviewChanges } from '../../hooks/useReviewChanges'

export function ChangesTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)

  const {
    files: diffFiles,
    loading,
    isSnapshot,
    snapshotCapturedAt,
    snapshotTruncated,
    fileDiff
  } = useReviewChanges(selectedTaskId)

  // Parse the raw diff text into structured format for DiffViewer
  // Must be called before early returns (React Hooks rule)
  const parsedDiff = useMemo(() => {
    if (!fileDiff) return []
    return parseDiff(fileDiff)
  }, [fileDiff])

  if (loading) {
    return (
      <div className="cr-changes">
        <div className="cr-changes__diff cr-changes__diff--loading">
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

  return (
    <div className="cr-changes" data-testid="cr-changes">
      {isSnapshot && (
        <div
          className="cr-changes__snapshot-banner"
          data-testid="cr-changes-snapshot-banner"
          title={snapshotCapturedAt ?? ''}
        >
          Worktree no longer available — showing archived snapshot
          {snapshotTruncated ? ' (file stats only — diff was too large to preserve)' : ''}
        </div>
      )}
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
