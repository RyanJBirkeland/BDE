import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'

interface NeonCardProps {
  accent?: NeonAccent | undefined
  title?: string | undefined
  icon?: ReactNode | undefined
  action?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
  style?: React.CSSProperties | undefined
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
    background: `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${'var(--bde-bg)'})`,
    border: `1px solid ${neonVar(accent, 'border')}`,
    ...style
  } as React.CSSProperties

  return (
    <div
      className={`bde-card ${title ? 'bde-card--with-title' : 'bde-card--no-title'} ${className}`.trim()}
      style={cardStyle}
    >
      {title && (
        <div
          className="bde-card__header"
          style={{
            borderBottom: `1px solid ${neonVar(accent, 'border')}`
          }}
        >
          {icon && (
            <span className="bde-card__icon" style={{ color: neonVar(accent, 'color') }}>
              {icon}
            </span>
          )}
          <span className="bde-card__title" style={{ color: neonVar(accent, 'color') }}>
            {title}
          </span>
          {action && <span className="bde-card__action">{action}</span>}
        </div>
      )}
      <div className={title ? 'bde-card__body' : 'bde-card__body--no-title'}>{children}</div>
    </div>
  )
}
