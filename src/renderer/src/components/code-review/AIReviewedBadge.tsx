import { Sparkles } from 'lucide-react'
import type { JSX } from 'react'

interface Props {
  commentCount: number
}

export function AIReviewedBadge({ commentCount }: Props): JSX.Element {
  return (
    <span className="cr-ai-reviewed" aria-label={`AI reviewed — ${commentCount} comments`}>
      <Sparkles size={12} />
      <span className="cr-ai-reviewed__label">AI Reviewed</span>
      {commentCount > 0 && <span className="cr-ai-reviewed__count">{commentCount}</span>}
    </span>
  )
}
