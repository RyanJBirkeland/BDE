import { CheckCircle2, XCircle, MessageSquare, MinusCircle } from 'lucide-react'
import type { PrReview } from '../../../../shared/types'
import { renderMarkdown } from '../../lib/render-markdown'
import { timeAgo } from '../../lib/format'

interface PRStationReviewsProps {
  reviews: PrReview[]
  loading: boolean
}

function ReviewStateBadge({ state }: { state: PrReview['state'] }) {
  switch (state) {
    case 'APPROVED':
      return (
        <span className="pr-review__badge pr-review__badge--approved">
          <CheckCircle2 size={12} /> Approved
        </span>
      )
    case 'CHANGES_REQUESTED':
      return (
        <span className="pr-review__badge pr-review__badge--changes">
          <XCircle size={12} /> Changes requested
        </span>
      )
    case 'COMMENTED':
      return (
        <span className="pr-review__badge pr-review__badge--commented">
          <MessageSquare size={12} /> Commented
        </span>
      )
    case 'DISMISSED':
      return (
        <span className="pr-review__badge pr-review__badge--dismissed">
          <MinusCircle size={12} /> Dismissed
        </span>
      )
    default:
      return null
  }
}

/** Deduplicate reviews: keep the latest review per user (GitHub keeps all states). */
function latestReviewPerUser(reviews: PrReview[]): PrReview[] {
  const map = new Map<string, PrReview>()
  for (const r of reviews) {
    if (r.state === 'PENDING') continue
    const existing = map.get(r.user.login)
    if (!existing || new Date(r.submitted_at) > new Date(existing.submitted_at)) {
      map.set(r.user.login, r)
    }
  }
  return Array.from(map.values())
}

export function PRStationReviews({ reviews, loading }: PRStationReviewsProps) {
  if (loading) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Reviews</h3>
        <div className="pr-detail__checks-loading">
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
        </div>
      </div>
    )
  }

  const latest = latestReviewPerUser(reviews)

  if (latest.length === 0) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Reviews</h3>
        <span className="pr-detail__no-data">No reviews yet</span>
      </div>
    )
  }

  return (
    <div className="pr-detail__section">
      <h3 className="pr-detail__section-title">
        Reviews
        <span className="bde-count-badge">{latest.length}</span>
      </h3>
      <div className="pr-reviews">
        {latest.map((review) => (
          <div key={review.id} className="pr-review">
            <div className="pr-review__header">
              <span className="pr-review__author">{review.user.login}</span>
              <ReviewStateBadge state={review.state} />
              <span className="pr-review__time">{timeAgo(review.submitted_at)}</span>
            </div>
            {review.body && (
              <div
                className="pr-review__body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(review.body) }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
