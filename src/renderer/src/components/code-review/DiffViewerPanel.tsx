import './DiffViewerPanel.css'
import { Copy } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { ChangesTab } from './ChangesTab'
import { CommitsTab } from './CommitsTab'
import { TestsTab } from './TestsTab'
import { AIReviewedBadge } from './AIReviewedBadge'
import { toast } from '../../stores/toasts'
import type { DiffMode } from '../../stores/codeReview'

export function DiffViewerPanel(): React.JSX.Element {
  const diffMode = useCodeReviewStore((s) => s.diffMode)
  const setDiffMode = useCodeReviewStore((s) => s.setDiffMode)
  const selectedDiffFile = useCodeReviewStore((s) => s.selectedDiffFile)
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const finding = useReviewPartnerStore((s) => {
    if (!selectedTaskId || !selectedDiffFile) return undefined
    return s.reviewByTask[selectedTaskId]?.result?.findings.perFile.find(
      (f) => f.path === selectedDiffFile
    )
  })

  const handleCopyPath = (): void => {
    if (!selectedDiffFile) return
    navigator.clipboard.writeText(selectedDiffFile)
    toast.success('Path copied to clipboard')
  }

  const modes: Array<{ key: DiffMode; label: string }> = [
    { key: 'diff', label: 'Diff' },
    { key: 'commits', label: 'Commits' },
    { key: 'tests', label: 'Tests' }
  ]

  return (
    <div className="cr-diffviewer">
      <div className="cr-diffviewer__header">
        <div className="cr-diffviewer__breadcrumb">
          {selectedDiffFile ? (
            <>
              <span className="cr-diffviewer__path">{selectedDiffFile}</span>
              <button
                className="cr-diffviewer__copy-btn"
                onClick={handleCopyPath}
                title="Copy path"
              >
                <Copy size={12} />
              </button>
              {finding && <AIReviewedBadge commentCount={finding.commentCount} />}
            </>
          ) : (
            <span className="cr-diffviewer__path cr-diffviewer__path--empty">
              {diffMode === 'diff' ? 'Select a file to view diff' : ''}
            </span>
          )}
        </div>
        <div className="cr-diffviewer__mode-control">
          {modes.map((mode) => (
            <button
              key={mode.key}
              className={`cr-diffviewer__mode-pill ${diffMode === mode.key ? 'cr-diffviewer__mode-pill--active' : ''}`}
              onClick={() => setDiffMode(mode.key)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <div className="cr-diffviewer__body">
        {diffMode === 'diff' && <ChangesTab />}
        {diffMode === 'commits' && <CommitsTab />}
        {diffMode === 'tests' && <TestsTab />}
      </div>
    </div>
  )
}
