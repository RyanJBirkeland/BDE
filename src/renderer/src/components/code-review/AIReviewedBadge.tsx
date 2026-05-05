import { Sparkles } from 'lucide-react'
import type { JSX } from 'react'

interface Props {
  commentCount: number
}

/**
 * V2 chip badge shown in the diff breadcrumb for AI-reviewed files.
 * Uses the chip vocabulary from §3.4: height 18, mono 9px weight 600,
 * color-mix tinted background + border.
 */
export function AIReviewedBadge({ commentCount }: Props): JSX.Element {
  return (
    <span
      aria-label={`AI reviewed — ${commentCount} comments`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 18,
        padding: '0 6px',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        borderRadius: 3,
        background: 'color-mix(in oklch, var(--st-review) 18%, transparent)',
        color: 'var(--st-review)',
        border: '1px solid color-mix(in oklch, var(--st-review) 30%, transparent)',
        flexShrink: 0
      }}
    >
      <Sparkles size={8} />
      <span>AI</span>
      {commentCount > 0 && <span>{commentCount}</span>}
    </span>
  )
}
