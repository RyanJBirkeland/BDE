import { useState } from 'react'
import { Button } from '../ui/Button'
import { createReview, type CreateReviewBody } from '../../lib/github-api'
import { usePendingReviewStore } from '../../stores/pendingReview'
import { toast } from '../../stores/toasts'
import { REPO_OPTIONS } from '../../lib/constants'
import type { OpenPr } from '../../../../shared/types'

interface ReviewSubmitDialogProps {
  pr: OpenPr
  prKey: string
  onClose: () => void
  onSubmitted: () => void
}

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

const EMPTY_COMMENTS: [] = []

export function ReviewSubmitDialog({ pr, prKey, onClose, onSubmitted }: ReviewSubmitDialogProps) {
  const [body, setBody] = useState('')
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [submitting, setSubmitting] = useState(false)
  const pendingComments = usePendingReviewStore((s) => s.pendingComments[prKey] ?? EMPTY_COMMENTS)
  const clearPending = usePendingReviewStore((s) => s.clearPending)

  const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)

  const handleSubmit = async () => {
    if (!repo) return
    setSubmitting(true)
    try {
      const review: CreateReviewBody = {
        event,
        body: body.trim() || undefined,
        comments: pendingComments.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
          ...(c.startLine ? { start_line: c.startLine } : {}),
          ...(c.startSide ? { start_side: c.startSide } : {}),
          body: c.body
        }))
      }
      await createReview(repo.owner, repo.label, pr.number, review)
      clearPending(prKey)
      toast.success('Review submitted')
      onSubmitted()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  const eventOptions: { value: ReviewEvent; label: string; description: string }[] = [
    { value: 'COMMENT', label: 'Comment', description: 'Submit general feedback without approval' },
    { value: 'APPROVE', label: 'Approve', description: 'Approve this pull request' },
    {
      value: 'REQUEST_CHANGES',
      label: 'Request changes',
      description: 'Submit feedback that must be addressed'
    }
  ]

  return (
    <div className="review-dialog-backdrop" onClick={onClose}>
      <div className="review-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="review-dialog__title">Submit Review</h3>

        <textarea
          className="review-dialog__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave an overall comment (optional)"
          rows={4}
        />

        <div className="review-dialog__events">
          {eventOptions.map((opt) => (
            <label key={opt.value} className="review-dialog__event">
              <input
                type="radio"
                name="review-event"
                value={opt.value}
                checked={event === opt.value}
                onChange={() => setEvent(opt.value)}
              />
              <div>
                <span className="review-dialog__event-label">{opt.label}</span>
                <span className="review-dialog__event-desc">{opt.description}</span>
              </div>
            </label>
          ))}
        </div>

        {pendingComments.length > 0 && (
          <div className="review-dialog__pending-count">
            {pendingComments.length} pending comment{pendingComments.length > 1 ? 's' : ''} will be
            included
          </div>
        )}

        <div className="review-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={submitting}>
            Submit review
          </Button>
        </div>
      </div>
    </div>
  )
}
