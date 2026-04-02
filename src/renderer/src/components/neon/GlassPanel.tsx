import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

interface GlassPanelProps {
  accent?: NeonAccent
  blur?: 'sm' | 'md' | 'lg'
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}

const BLUR_MAP = {
  sm: 'blur(8px) saturate(180%)',
  md: 'blur(16px) saturate(180%)',
  lg: 'blur(40px) saturate(180%)'
}

export function GlassPanel({
  accent,
  blur = 'md',
  children,
  className = '',
  style
}: GlassPanelProps) {
  const borderVal = accent ? neonVar(accent, 'border') : tokens.neon.surfaceDim
  return (
    <div
      className={`glass-panel ${className}`.trim()}
      style={{
        backdropFilter: BLUR_MAP[blur],
        WebkitBackdropFilter: BLUR_MAP[blur],
        background: accent
          ? `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${tokens.neon.surfaceDeep})`
          : tokens.neon.surfaceDeep,
        border: `1px solid ${borderVal}`,
        borderRadius: tokens.radius.xl,
        boxShadow: 'var(--neon-glass-shadow), var(--neon-glass-edge)',
        ...style
      }}
    >
      {children}
    </div>
  )
}
