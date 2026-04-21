import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  padding?: 'none' | 'sm' | 'md' | 'lg' | undefined
  className?: string | undefined
  onClick?: (() => void) | undefined
  active?: boolean | undefined
}

export function Card({
  children,
  padding = 'md',
  className,
  onClick,
  active = false
}: CardProps): React.JSX.Element {
  const classes = [
    'bde-card',
    `bde-card--pad-${padding}`,
    active && 'bde-card--active',
    onClick && 'bde-card--clickable',
    className
  ]
    .filter(Boolean)
    .join(' ')

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
    >
      {children}
    </div>
  )
}
