import type { CSSProperties, ReactNode } from 'react'

export type BadgeProps = {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
  size?: 'sm' | 'md'
  children: ReactNode
  style?: CSSProperties
}

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  style,
}: BadgeProps) {
  return (
    <span className={`bde-badge bde-badge--${variant} bde-badge--${size}`} style={style}>
      <span className="bde-badge__dot" />
      {children}
    </span>
  )
}
