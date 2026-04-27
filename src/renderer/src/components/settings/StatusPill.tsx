/**
 * StatusPill — status indicator badge for settings sections.
 */
import type { ReactNode } from 'react'

export type StatusVariant = 'success' | 'info' | 'warning' | 'neutral' | 'error'

interface StatusPillProps {
  label: string
  variant: StatusVariant
}

export function StatusPill({ label, variant }: StatusPillProps): ReactNode {
  // Map StatusVariant to fleet-badge variants
  const badgeVariant = variant === 'neutral' ? 'muted' : variant === 'error' ? 'danger' : variant

  return (
    <span className={`fleet-badge fleet-badge--md fleet-badge--${badgeVariant}`}>
      {variant === 'success' && <span className="fleet-badge__dot" aria-hidden="true" />}
      {label}
    </span>
  )
}
