import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface NeonBadgeProps {
  accent: NeonAccent
  label: string
  pulse?: boolean
}

export function NeonBadge({ accent, label, pulse = false }: NeonBadgeProps) {
  return (
    <span
      className={pulse ? 'neon-pulse' : ''}
      style={
        {
          color: neonVar(accent, 'color'),
          background: neonVar(accent, 'surface'),
          border: `1px solid ${neonVar(accent, 'border')}`,
          borderRadius: tokens.radius.full,
          padding: `2px ${tokens.space[2]}`,
          fontSize: tokens.size.xs,
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          gap: tokens.space[1],
          '--pulse-shadow-min': `0 0 6px ${neonVar(accent, 'border')}`,
          '--pulse-shadow-max': `0 0 16px ${neonVar(accent, 'border')}`,
          animation: pulse ? 'neon-pulse 3s ease-in-out infinite' : undefined
        } as React.CSSProperties
      }
    >
      {label}
    </span>
  )
}
