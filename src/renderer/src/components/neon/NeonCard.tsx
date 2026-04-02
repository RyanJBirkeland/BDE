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
}: NeonCardProps) {
  const cardStyle: React.CSSProperties = {
    '--card-accent': neonVar(accent, 'color'),
    '--card-accent-border': neonVar(accent, 'border'),
    '--card-accent-surface': neonVar(accent, 'surface'),
    '--card-accent-glow': neonVar(accent, 'glow'),
    background: `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${tokens.neon.surfaceDeep})`,
    border: `1px solid ${neonVar(accent, 'border')}`,
    borderRadius: tokens.radius.xl,
    backdropFilter: 'var(--neon-glass-blur)',
    WebkitBackdropFilter: 'var(--neon-glass-blur)',
    boxShadow: `var(--neon-glass-shadow), var(--neon-glass-edge)`,
    padding: title ? '0' : tokens.space[3],
    overflow: 'hidden',
    transition: `box-shadow ${tokens.transition.base}, transform ${tokens.transition.base}`,
    ...style
  } as React.CSSProperties

  return (
    <div className={`neon-card ${className}`.trim()} style={cardStyle}>
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
            padding: `${tokens.space[2]} ${tokens.space[3]}`,
            borderBottom: `1px solid ${neonVar(accent, 'border')}`
          }}
        >
          {icon && <span style={{ color: neonVar(accent, 'color'), display: 'flex' }}>{icon}</span>}
          <span
            style={{
              color: neonVar(accent, 'color'),
              fontSize: tokens.size.xs,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontWeight: 600
            }}
          >
            {title}
          </span>
          {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
        </div>
      )}
      <div style={{ padding: title ? tokens.space[3] : '0' }}>{children}</div>
    </div>
  )
}
