import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'

interface StatusBarProps {
  title: string
  status: 'ok' | 'error' | 'warning'
  accent?: NeonAccent | undefined
  children?: ReactNode | undefined
}

export function StatusBar({
  title,
  status,
  accent = 'purple',
  children
}: StatusBarProps): React.JSX.Element {
  return (
    <div
      className="status-bar"
      style={{
        borderBottom: `1px solid ${neonVar(accent, 'border')}`
      }}
    >
      <div data-role="status-dot" className={`status-bar__dot status-bar__dot--${status}`} />
      <span className="status-bar__title text-gradient-aurora">{title}</span>
      {children && <span className="status-bar__children">{children}</span>}
    </div>
  )
}
