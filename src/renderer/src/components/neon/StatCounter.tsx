import { useState } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface StatCounterProps {
  label: string
  value: number | string
  accent: NeonAccent
  suffix?: string
  trend?: {
    direction: 'up' | 'down'
    label: string
  }
  icon?: React.ReactNode
  onClick?: () => void
}

export function StatCounter({
  label,
  value,
  accent,
  suffix,
  trend,
  icon,
  onClick
}: StatCounterProps) {
  const [hovered, setHovered] = useState(false)
  const isClickable = !!onClick

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: neonVar(accent, 'surface'),
        border: `1px solid ${neonVar(accent, 'border')}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space[3],
        cursor: isClickable ? 'pointer' : undefined,
        opacity: isClickable && hovered ? 0.85 : 1,
        transition: 'opacity 0.15s ease'
      }}
    >
      <div
        data-role="stat-label"
        style={{
          color: neonVar(accent, 'color'),
          fontSize: tokens.size.xs,
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[1]
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: tokens.space[1],
          marginTop: tokens.space[1]
        }}
      >
        <span
          style={{
            color: tokens.neon.text,
            fontSize: tokens.size.xxl,
            fontWeight: 800,
            textShadow: neonVar(accent, 'glow')
          }}
        >
          {value}
        </span>
        {suffix && (
          <span
            style={{
              color: neonVar(accent, 'color'),
              fontSize: tokens.size.xs,
              opacity: 0.6
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {trend && (
        <div
          style={{
            color: trend.direction === 'down' ? 'var(--neon-cyan)' : 'var(--neon-red)',
            fontSize: tokens.size.xs,
            marginTop: tokens.space[1],
            opacity: 0.7
          }}
        >
          {trend.direction === 'down' ? '↓' : '↑'} {trend.label}
        </div>
      )}
    </div>
  )
}
