import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  padding?: 'none' | 'sm' | 'md' | 'lg'
  className?: string
  onClick?: () => void
  active?: boolean
}

export function Card({ children, padding = 'md', className, onClick, active = false }: CardProps) {
  const classes = [
    'bde-card',
    `bde-card--pad-${padding}`,
    active && 'bde-card--active',
    onClick && 'bde-card--clickable',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} onClick={onClick}>
      {children}
    </div>
  )
}
