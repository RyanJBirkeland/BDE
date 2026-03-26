import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface StatusBarProps {
  title: string
  status: 'ok' | 'error' | 'warning'
  accent?: NeonAccent
  children?: ReactNode
}

const STATUS_COLORS = {
  ok: 'var(--neon-cyan)',
  error: 'var(--neon-red)',
  warning: 'var(--neon-orange)'
} as const

const STATUS_GLOWS = {
  ok: '0 0 8px var(--neon-cyan)',
  error: '0 0 8px var(--neon-red)',
  warning: '0 0 8px var(--neon-orange)'
} as const

export function StatusBar({ title, status, accent = 'purple', children }: StatusBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[2]} ${tokens.space[4]}`,
        borderBottom: `1px solid ${neonVar(accent, 'border')}`
      }}
    >
      <div
        data-role="status-dot"
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: STATUS_COLORS[status],
          boxShadow: STATUS_GLOWS[status],
          animation: 'neon-breathe 2s ease-in-out infinite'
        }}
      />
      <span
        style={{
          color: neonVar(accent, 'color'),
          fontSize: tokens.size.xs,
          textTransform: 'uppercase',
          letterSpacing: '2px',
          fontWeight: 600
        }}
      >
        {title}
      </span>
      {children && (
        <span
          style={{
            marginLeft: 'auto',
            color: tokens.neon.textDim,
            fontSize: tokens.size.xs,
            fontFamily: tokens.font.code
          }}
        >
          {children}
        </span>
      )}
    </div>
  )
}
