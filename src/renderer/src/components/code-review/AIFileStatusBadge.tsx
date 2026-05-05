import type { JSX } from 'react'

export type FileReviewStatus = 'pass' | 'concern' | 'fail' | 'unreviewed'

/**
 * V2 chip badge for AI file review status.
 * Unreviewed files render nothing — absence of badge is the affordance.
 */
export function AIFileStatusBadge({ status }: { status: FileReviewStatus }): JSX.Element | null {
  if (status === 'unreviewed') return null

  const config = STATUS_CONFIG[status]
  return (
    <span
      role="img"
      aria-label={config.ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 18,
        padding: '0 6px',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.02em',
        borderRadius: 3,
        background: `color-mix(in oklch, ${config.color} 18%, transparent)`,
        color: config.color,
        border: `1px solid color-mix(in oklch, ${config.color} 30%, transparent)`,
        flexShrink: 0
      }}
    >
      {config.label}
    </span>
  )
}

const STATUS_CONFIG: Record<
  Exclude<FileReviewStatus, 'unreviewed'>,
  { color: string; label: string; ariaLabel: string }
> = {
  pass: {
    color: 'var(--st-done)',
    label: 'OK',
    ariaLabel: 'File reviewed clean'
  },
  concern: {
    color: 'var(--st-blocked)',
    label: '?',
    ariaLabel: 'File has concerns'
  },
  fail: {
    color: 'var(--st-failed)',
    label: '✗',
    ariaLabel: 'File has issues'
  }
}
