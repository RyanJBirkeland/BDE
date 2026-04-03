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
  return (
    <span className={`stg-status-pill stg-status-pill--${variant}`}>
      {variant === 'success' && <span className="stg-status-pill__dot" aria-hidden="true" />}
      {label}
    </span>
  )
}
