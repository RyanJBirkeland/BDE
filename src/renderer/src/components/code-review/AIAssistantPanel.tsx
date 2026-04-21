import './AIAssistantPanel.css'
import { Sparkles, X, MoreHorizontal } from 'lucide-react'
import { useState, useEffect, useRef, type JSX } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { useReviewPartnerActions } from '../../hooks/useReviewPartnerActions'
import { ReviewMetricsRow } from './ReviewMetricsRow'
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
      <div className="cr-assistant__header">
        <div className="cr-assistant__title">
          <Sparkles size={14} className="cr-assistant__sparkle" />
          <div>
            <div className="cr-assistant__title-label">AI Review Partner</div>
          </div>
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

      <ReviewMetricsRow
        qualityScore={result?.qualityScore}
        issuesCount={result?.issuesCount}
        filesCount={result?.filesCount}
        loading={loading}
      />

      {errored && (
        <div className="cr-assistant__error" role="alert">
          {reviewState?.error ?? 'Review failed.'}
          <button
            type="button"
            onClick={() => {
              if (selectedTaskId) void autoReview(selectedTaskId, { force: true })
            }}
          >
            Retry
          </button>
        </div>
      )}

      <ReviewMessageList
        messages={messages}
        emptyMessage={
          !selectedTaskId
            ? 'Select a task to start reviewing.'
            : loading
              ? 'Reviewing...'
              : 'No review yet. Open this task to auto-review.'
        }
      />

      <ReviewQuickActions
        onAction={(prompt) => {
          if (!selectedTaskId || streaming) return
          void sendMessage(selectedTaskId, prompt)
        }}
        disabled={!selectedTaskId || streaming}
      />

      <ReviewChatInput
        streaming={streaming}
        disabled={!selectedTaskId}
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
