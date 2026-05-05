import './AIAssistantPanel.css'
import { Sparkles, X, MoreHorizontal } from 'lucide-react'
import { useState, useEffect, useRef, type JSX } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { useReviewPartnerActions } from '../../hooks/useReviewPartnerActions'
import { ReviewMessageList } from './ReviewMessageList'
import { ReviewQuickActions } from './ReviewQuickActions'
import { ReviewChatInput } from './ReviewChatInput'
import type { PartnerMessage } from '../../../../shared/types'

// Stable reference for the empty-messages fallback. Returning a fresh `[]`
// literal from a Zustand selector breaks React's useSyncExternalStore contract
// (getSnapshot must return the same reference when state hasn't changed),
// which triggers an infinite re-render loop the moment the panel mounts with
// no messages for the selected task ("Maximum update depth exceeded").
const EMPTY_MESSAGES: PartnerMessage[] = []

function qualityVerdict(score: number | undefined): string {
  if (score === undefined) return 'Loading…'
  if (score >= 75) return 'Strong'
  if (score >= 50) return 'Mixed'
  return 'Concerns'
}

export function AIAssistantPanel(): JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)

  const reviewState = useReviewPartnerStore((s) =>
    selectedTaskId ? s.reviewByTask[selectedTaskId] : undefined
  )
  const messages = useReviewPartnerStore((s) =>
    selectedTaskId ? (s.messagesByTask[selectedTaskId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  )
  const togglePanel = useReviewPartnerStore((s) => s.togglePanel)
  const activeStream = useReviewPartnerStore((s) =>
    selectedTaskId ? s.activeStreamByTask[selectedTaskId] : null
  )
  const clearMessages = useReviewPartnerStore((s) => s.clearMessages)

  const { autoReview, sendMessage, abortStream } = useReviewPartnerActions()

  const [menuOpen, setMenuOpen] = useState(false)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const streaming = !!activeStream

  useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const result = reviewState?.result
  const loading = reviewState?.status === 'loading'
  const errored = reviewState?.status === 'error'

  return (
    <aside className="cr-assistant" role="complementary" aria-label="AI Review Partner">
      {/* Header — drop the gradient glow from V1 */}
      <div className="cr-assistant__header">
        <div className="cr-assistant__title">
          <Sparkles size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="cr-assistant__title-label">AI Review Partner</span>
        </div>
        <div className="cr-assistant__header-actions" ref={menuRef}>
          <button
            type="button"
            className="cr-assistant__menu-trigger"
            aria-label="More options"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            type="button"
            className="cr-assistant__close"
            aria-label="Close AI Review Partner"
            onClick={togglePanel}
          >
            <X size={14} />
          </button>
          {menuOpen && (
            <div className="cr-assistant__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (selectedTaskId) {
                    void autoReview(selectedTaskId, { force: true })
                  }
                  setMenuOpen(false)
                }}
                disabled={!selectedTaskId}
              >
                Re-review
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (selectedTaskId) clearMessages(selectedTaskId)
                  setMenuOpen(false)
                }}
                disabled={!selectedTaskId}
              >
                Clear thread
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quality section */}
      <div className="cr-section">
        <div className="cr-section__head">
          <span className="cr-section__eyebrow">Quality</span>
          <span className="cr-section__title">{qualityVerdict(result?.qualityScore)}</span>
        </div>
        <div className="cr-metrics-grid" role="group" aria-label="AI review metrics">
          <div className="cr-mini-stat" role="status" aria-label={`Quality score ${result?.qualityScore ?? '—'} out of 100`}>
            <span className="cr-mini-stat__value">{loading || result?.qualityScore === undefined ? '—' : result.qualityScore}</span>
            <span className="cr-mini-stat__label">Score</span>
          </div>
          <div className="cr-mini-stat" role="status" aria-label={`${result?.issuesCount ?? '—'} issues found`}>
            <span className="cr-mini-stat__value">{loading || result?.issuesCount === undefined ? '—' : result.issuesCount}</span>
            <span className="cr-mini-stat__label">Issues</span>
          </div>
          <div className="cr-mini-stat" role="status" aria-label={`${result?.filesCount ?? '—'} files changed`}>
            <span className="cr-mini-stat__value">{loading || result?.filesCount === undefined ? '—' : result.filesCount}</span>
            <span className="cr-mini-stat__label">Files</span>
          </div>
        </div>
      </div>

      {/* Error block */}
      {errored && (
        <div className="cr-assistant__error" role="alert">
          <div className="cr-assistant__error-summary">
            <span>AI Review unavailable</span>
            <div className="cr-assistant__error-actions">
              <button
                type="button"
                className="cr-assistant__error-details-toggle"
                onClick={() => setShowErrorDetails((v) => !v)}
                aria-expanded={showErrorDetails}
              >
                {showErrorDetails ? 'Hide details' : 'Details'}
              </button>
              <button
                type="button"
                className="cr-assistant__error-retry"
                onClick={() => {
                  if (selectedTaskId) void autoReview(selectedTaskId, { force: true })
                }}
              >
                Retry
              </button>
            </div>
          </div>
          <p className="cr-assistant__error-hint">Review the Diff and Commits tabs manually.</p>
          {showErrorDetails && (
            <pre className="cr-assistant__error-details">
              {reviewState?.error ?? 'Unknown error'}
            </pre>
          )}
        </div>
      )}

      {/* Conversation section — grows to fill remaining space; pulse only here */}
      <div className="cr-section cr-section--conversation">
        <div className="cr-section__head">
          <span className="cr-section__eyebrow">Thread</span>
          <span className="cr-section__title">Conversation</span>
        </div>
        <ReviewMessageList
          messages={messages}
          streaming={streaming}
          emptyMessage={
            !selectedTaskId
              ? 'Select a task to start reviewing.'
              : loading
                ? 'Reviewing...'
                : 'No review yet. Open this task to auto-review.'
          }
        />
      </div>

      {/* Quick actions section */}
      <div className="cr-section">
        <div className="cr-section__head">
          <span className="cr-section__eyebrow">Quick Actions</span>
        </div>
        <ReviewQuickActions
          onAction={(prompt) => {
            if (!selectedTaskId || streaming) return
            void sendMessage(selectedTaskId, prompt)
          }}
          disabled={!selectedTaskId || streaming}
          disabledReason={
            !selectedTaskId ? 'Select a review task first' : streaming ? 'Reviewing…' : undefined
          }
        />
      </div>

      {/* Input — no eyebrow/title, just the control row */}
      <ReviewChatInput
        streaming={streaming}
        disabled={!selectedTaskId}
        disabledReason={!selectedTaskId ? 'Select a review task first' : undefined}
        onSend={(content) => {
          if (!selectedTaskId) return
          void sendMessage(selectedTaskId, content)
        }}
        onAbort={() => {
          if (!selectedTaskId) return
          void abortStream(selectedTaskId)
        }}
      />
    </aside>
  )
}
