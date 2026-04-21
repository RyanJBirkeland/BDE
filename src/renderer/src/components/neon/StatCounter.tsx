import { type NeonAccent, neonVar } from './types'

interface StatCounterProps {
  label: string
  value: number | string
  accent: NeonAccent
  suffix?: string | undefined
  trend?: {
    direction: 'up' | 'down'
    label: string
  }
  icon?: React.ReactNode | undefined
  onClick?: (() => void) | undefined
}

export function StatCounter({
  label,
  value,
  accent,
  suffix,
  trend,
  icon,
  onClick
}: StatCounterProps): React.JSX.Element {
  const isClickable = !!onClick
  const Component = isClickable ? 'button' : 'div'

  return (
    <Component
      className={`stat-counter ${isClickable ? 'stat-counter--clickable' : ''}`}
      onClick={onClick}
      style={{
        background: neonVar(accent, 'surface'),
        border: `1px solid ${neonVar(accent, 'border')}`
      }}
    >
      <div
        data-role="stat-label"
        className="stat-counter__label"
        style={{
          color: neonVar(accent, 'color')
        }}
      >
        {icon}
        {label}
      </div>
      <div className="stat-counter__value-row">
        <span className="stat-counter__value">{value}</span>
        {suffix && (
          <span
            className="stat-counter__suffix"
            style={{
              color: neonVar(accent, 'color')
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {trend && (
        <div className={`stat-counter__trend stat-counter__trend--${trend.direction}`}>
          {trend.direction === 'down' ? '↓' : '↑'} {trend.label}
        </div>
      )}
    </Component>
  )
}
