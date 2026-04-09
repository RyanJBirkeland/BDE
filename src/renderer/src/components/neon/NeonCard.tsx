import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface NeonCardProps {
  accent?: NeonAccent
  title?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}

export function NeonCard({
  accent = 'purple',
  title,
  icon,
  action,
  children,
  className = '',
  style
}: NeonCardProps): React.JSX.Element {
  const cardStyle: React.CSSProperties = {
    '--card-accent': neonVar(accent, 'color'),
    '--card-accent-border': neonVar(accent, 'border'),
    '--card-accent-surface': neonVar(accent, 'surface'),
    background: `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${tokens.color.bg})`,
    border: `1px solid ${neonVar(accent, 'border')}`,
    ...style
  } as React.CSSProperties

  return (
    <div
      className={`neon-card ${title ? 'neon-card--with-title' : 'neon-card--no-title'} ${className}`.trim()}
      style={cardStyle}
    >
      {title && (
        <div
          className="neon-card__header"
          style={{
            borderBottom: `1px solid ${neonVar(accent, 'border')}`
          }}
        >
          {icon && (
            <span className="neon-card__icon" style={{ color: neonVar(accent, 'color') }}>
              {icon}
            </span>
          )}
          <span className="neon-card__title" style={{ color: neonVar(accent, 'color') }}>
            {title}
          </span>
          {action && <span className="neon-card__action">{action}</span>}
        </div>
      )}
      <div className={title ? 'neon-card__body' : 'neon-card__body--no-title'}>{children}</div>
    </div>
  )
}
