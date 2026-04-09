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

export function GlassPanel({
  accent,
  blur: _blur,
  children,
  className = '',
  style
}: GlassPanelProps): React.JSX.Element {
  const borderVal = accent ? neonVar(accent, 'border') : tokens.color.border
  return (
    <div
      className={`glass-panel ${className}`.trim()}
      style={{
        background: accent
          ? `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${tokens.color.bg})`
          : tokens.color.bg,
        border: `1px solid ${borderVal}`,
        borderRadius: tokens.radius.xl,
        ...style
      }}
    >
      {children}
    </div>
  )
}
