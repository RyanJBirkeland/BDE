import './FileTreePanel.css'
import { useState } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { Plus, Minus, Edit2, ChevronRight, FileX } from 'lucide-react'
import { AIFileStatusBadge, type FileReviewStatus } from './AIFileStatusBadge'
import { EmptyState } from '../ui/EmptyState'

const DOT_PREVIEW_LIMIT = 8

export function FileTreePanel(): React.JSX.Element {
  const diffFiles = useCodeReviewStore((s) => s.diffFiles)
  const selectedDiffFile = useCodeReviewStore((s) => s.selectedDiffFile)
  const setSelectedDiffFile = useCodeReviewStore((s) => s.setSelectedDiffFile)
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const reviewResult = useReviewPartnerStore((s) =>
    selectedTaskId ? s.reviewByTask[selectedTaskId]?.result : undefined
  )
  // Default to expanded — the 44px rail is an opt-in collapsed state
  const [isExpanded, setIsExpanded] = useState(true)

  function statusForPath(path: string): FileReviewStatus {
    const finding = reviewResult?.findings.perFile.find((f) => f.path === path)
    if (!finding) return 'unreviewed'
    // Map shared data-layer statuses to V2 display statuses
    return finding.status === 'clean' ? 'pass' : 'fail'
  }

  function dotClassForStatus(status: string): string {
    if (status === 'A' || status === 'added') return 'fleet-dot fleet-dot--done'
    if (status === 'D' || status === 'deleted') return 'fleet-dot fleet-dot--failed'
    return 'fleet-dot fleet-dot--queued'
  }

  function statusIcon(status: string): React.JSX.Element {
    if (status === 'A' || status === 'added') return <Plus size={12} className="cr-file-added" />
    if (status === 'D' || status === 'deleted') return <Minus size={12} className="cr-file-deleted" />
    return <Edit2 size={12} className="cr-file-modified" />
  }

  const rootClass = isExpanded ? 'cr-filetree cr-filetree--expanded' : 'cr-filetree'
  const dotPreviewFiles = diffFiles?.slice(0, DOT_PREVIEW_LIMIT) ?? []
  const overflowCount = (diffFiles?.length ?? 0) - DOT_PREVIEW_LIMIT

  return (
    <aside className={rootClass} aria-label="Changed files" aria-expanded={isExpanded}>
      {!isExpanded && (
        <>
          <button
            className="cr-filetree__expand-btn"
            onClick={() => setIsExpanded(true)}
            aria-label="Expand file tree"
          >
            <ChevronRight size={14} />
          </button>
          {dotPreviewFiles.length > 0 && (
            <div className="cr-filetree__dot-preview" aria-hidden="true">
              {dotPreviewFiles.map((file) => (
                <button
                  key={file.path}
                  className={dotClassForStatus(file.status)}
                  onClick={() => {
                    setIsExpanded(true)
                    setSelectedDiffFile(file.path)
                  }}
                  title={file.path}
                  style={{ cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}
                />
              ))}
              {overflowCount > 0 && (
                <span className="cr-filetree__dot-overflow">+{overflowCount}</span>
              )}
            </div>
          )}
        </>
      )}

      {isExpanded && (
        <>
          <header className="cr-filetree__header">
            <span className="cr-filetree__eyebrow">Files</span>
            <span className="cr-filetree__label">Changed files</span>
            <span className="cr-filetree__count">{diffFiles?.length ?? 0}</span>
            <button
              className="cr-filetree__collapse-btn"
              onClick={() => setIsExpanded(false)}
              aria-label="Collapse file tree"
            >
              ×
            </button>
          </header>

          <div className="cr-filetree__list">
            {!diffFiles ? (
              <>
                {[1, 2, 3, 4, 5].map((n) => (
                  <div key={n} className="cr-filetree__row cr-filetree__row--skeleton">
                    <div className="cr-filetree__skeleton-icon" />
                    <div className="cr-filetree__skeleton-filename" />
                    <div className="cr-filetree__skeleton-badge" />
                    <div className="cr-filetree__skeleton-stats" />
                  </div>
                ))}
              </>
            ) : diffFiles.length === 0 ? (
              <EmptyState icon={<FileX size={48} />} title="No files changed" />
            ) : (
              diffFiles.map((file) => {
                const isSelected = file.path === selectedDiffFile
                const additionsLabel = `+${file.additions}`
                const deletionsLabel = `−${file.deletions}`
                return (
                  <button
                    key={file.path}
                    className={`cr-filetree__row${isSelected ? ' cr-filetree__row--selected' : ''}`}
                    onClick={() => setSelectedDiffFile(file.path)}
                    data-testid={`filetree-row-${file.path}`}
                  >
                    {statusIcon(file.status)}
                    <span className="cr-filetree__filename">{file.path}</span>
                    <AIFileStatusBadge status={statusForPath(file.path)} />
                    <span
                      className="cr-filetree__stats"
                      aria-label={`${file.additions} additions, ${file.deletions} deletions`}
                    >
                      <span style={{ color: 'var(--st-done)' }}>{additionsLabel}</span>
                      {' '}
                      <span style={{ color: 'var(--st-failed)' }}>{deletionsLabel}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </aside>
  )
}
