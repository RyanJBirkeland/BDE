import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface NeonProgressProps {
  value: number
  accent: NeonAccent
  label?: string
}

export function NeonProgress({ value, accent, label }: NeonProgressProps) {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div>
      {label && (
        <div
          style={{
            color: neonVar(accent, 'color'),
            fontSize: tokens.size.xs,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            marginBottom: tokens.space[1],
            fontWeight: 600
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          height: '4px',
          background: tokens.neon.surfaceDim,
          borderRadius: '2px',
          overflow: 'hidden'
        }}
      >
        <div
          data-role="progress-fill"
          style={{
            height: '100%',
            width: `${clamped}%`,
            background: `linear-gradient(90deg, ${neonVar(accent, 'color')}, var(--neon-blue))`,
            borderRadius: '2px',
            boxShadow: neonVar(accent, 'glow'),
            transition: 'width 300ms ease'
          }}
        />
      </div>
    </div>
  )
}
