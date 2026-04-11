import './AIAssistantPanel.css'
import { Sparkles, X, MoreHorizontal } from 'lucide-react'
import { useState, type JSX } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { ReviewMetricsRow } from './ReviewMetricsRow'
import { ReviewMessageList } from './ReviewMessageList'
import { ReviewQuickActions } from './ReviewQuickActions'
import { ReviewChatInput } from './ReviewChatInput'

export function AIAssistantPanel(): JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  // tasks available for future use (e.g. branch info display)
  useSprintTasks((s) => s.tasks)

  const reviewState = useReviewPartnerStore((s) =>
    selectedTaskId ? s.reviewByTask[selectedTaskId] : undefined
  )
  const messages = useReviewPartnerStore((s) =>
    selectedTaskId ? (s.messagesByTask[selectedTaskId] ?? []) : []
  )
  const togglePanel = useReviewPartnerStore((s) => s.togglePanel)
  const sendMessage = useReviewPartnerStore((s) => s.sendMessage)
  const abortStream = useReviewPartnerStore((s) => s.abortStream)
  const activeStream = useReviewPartnerStore((s) =>
    selectedTaskId ? s.activeStreamByTask[selectedTaskId] : null
  )
  const clearMessages = useReviewPartnerStore((s) => s.clearMessages)
  const autoReview = useReviewPartnerStore((s) => s.autoReview)

  const [menuOpen, setMenuOpen] = useState(false)
  const streaming = !!activeStream

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
            <div className="cr-assistant__title-model">Claude 4.6 Opus</div>
          </div>
        </div>
        <div className="cr-assistant__header-actions">
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
