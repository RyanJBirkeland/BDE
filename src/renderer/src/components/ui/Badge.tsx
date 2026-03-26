import type { CSSProperties, ReactNode } from 'react'

export type BadgeProps = {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
  size?: 'sm' | 'md'
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  className,
  style
}: BadgeProps) {
  const cls = [`bde-badge`, `bde-badge--${variant}`, `bde-badge--${size}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls} style={style}>
      <span className="bde-badge__dot" />
      {children}
    </span>
  )
}
