import { type NeonAccent, neonVar } from './types'

interface NeonBadgeProps {
  accent: NeonAccent
  label: string
  pulse?: boolean | undefined
}

export function NeonBadge({ accent, label, pulse = false }: NeonBadgeProps): React.JSX.Element {
  return (
    <span
      className={`bde-badge ${pulse ? 'bde-badge--pulse' : ''}`}
      style={
        {
          color: neonVar(accent, 'color'),
          background: neonVar(accent, 'surface'),
          border: `1px solid ${neonVar(accent, 'border')}`,
          '--pulse-shadow-min': `0 0 6px ${neonVar(accent, 'border')}`,
          '--pulse-shadow-max': `0 0 16px ${neonVar(accent, 'border')}`
        } as React.CSSProperties
      }
    >
      {label}
    </span>
  )
}
