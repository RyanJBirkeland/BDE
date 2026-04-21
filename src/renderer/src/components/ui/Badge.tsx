import type { CSSProperties, ReactNode } from 'react'

export type BadgeProps = {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | undefined
  size?: 'sm' | 'md' | undefined
  children: ReactNode
  className?: string | undefined
  style?: CSSProperties | undefined
}

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  className,
  style
}: BadgeProps): React.JSX.Element {
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
