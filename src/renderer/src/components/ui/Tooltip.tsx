import type { ReactNode } from 'react'

type TooltipProps = {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <span className={`bde-tooltip bde-tooltip--${side}`} data-tooltip={content}>
      {children}
    </span>
  )
}
