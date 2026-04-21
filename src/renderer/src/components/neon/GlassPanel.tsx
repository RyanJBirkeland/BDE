import { type ReactNode } from 'react'
import { type NeonAccent, neonVar } from './types'

interface GlassPanelProps {
  accent?: NeonAccent | undefined
  blur?: 'sm' | 'md' | 'lg' | undefined
  children: ReactNode
  className?: string | undefined
  style?: React.CSSProperties | undefined
}

export function GlassPanel({
  accent,
  blur: _blur,
  children,
  className = '',
  style
}: GlassPanelProps): React.JSX.Element {
  const borderVal = accent ? neonVar(accent, 'border') : 'var(--bde-border)'
  return (
    <div
      className={`glass-panel ${className}`.trim()}
      style={{
        background: accent
          ? `linear-gradient(135deg, ${neonVar(accent, 'surface')}, ${'var(--bde-bg)'})`
          : 'var(--bde-bg)',
        border: `1px solid ${borderVal}`,
        borderRadius: 'var(--bde-radius-xl)',
        ...style
      }}
    >
      {children}
    </div>
  )
}
