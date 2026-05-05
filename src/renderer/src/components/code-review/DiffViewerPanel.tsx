import './DiffViewerPanel.css'
import { Copy } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { ChangesTab } from './ChangesTab'
import { CommitsTab } from './CommitsTab'
import { VerificationTab } from './VerificationTab'
import { AIReviewedBadge } from './AIReviewedBadge'
import { toast } from '../../stores/toasts'
import type { DiffMode } from '../../stores/codeReview'

const TABS: Array<{ key: DiffMode; label: string }> = [
  { key: 'diff', label: 'Changes' },
  { key: 'commits', label: 'Commits' },
  { key: 'verification', label: 'Verification' }
]

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
                aria-label="Copy file path"
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

        {/* V2 tab strip — 2px accent bottom border on active tab */}
        <nav className="cr-diffviewer__tabs" role="tablist" aria-label="Review sections">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={diffMode === tab.key}
              className={`cr-diffviewer__tab${diffMode === tab.key ? ' cr-diffviewer__tab--active' : ''}`}
              onClick={() => setDiffMode(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="cr-diffviewer__body">
        {diffMode === 'diff' && <ChangesTab />}
        {diffMode === 'commits' && <CommitsTab />}
        {diffMode === 'verification' && <VerificationTab />}
      </div>
    </div>
  )
}
