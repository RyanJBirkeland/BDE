import { type NeonAccent, neonVar } from './types'

interface NeonProgressProps {
  value: number
  accent: NeonAccent
  label?: string | undefined
}

export function NeonProgress({ value, accent, label }: NeonProgressProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div>
      {label && (
        <div
          style={{
            color: neonVar(accent, 'color'),
            fontSize: 'var(--bde-size-xs)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            marginBottom: 'var(--bde-space-1)',
            fontWeight: 600
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          height: '4px',
          background: 'var(--bde-surface)',
          borderRadius: '2px',
          overflow: 'hidden'
        }}
      >
        <div
          data-role="progress-fill"
          style={{
            height: '100%',
            width: `${clamped}%`,
            background: `linear-gradient(90deg, ${neonVar(accent, 'color')}, var(--bde-status-review))`,
            borderRadius: '2px',
            transition: 'width 300ms ease'
          }}
        />
      </div>
    </div>
  )
}
