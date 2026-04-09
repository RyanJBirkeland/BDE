// src/renderer/src/components/neon/types.ts

export type NeonAccent = 'cyan' | 'pink' | 'blue' | 'purple' | 'orange' | 'red'

/** Maps a NeonAccent to its --bde-* CSS custom property */
const ACCENT_COLOR_MAP: Record<NeonAccent, string> = {
  cyan: 'var(--bde-accent)',
  pink: 'var(--bde-status-done)',
  blue: 'var(--bde-status-review)',
  purple: 'var(--bde-status-active)',
  orange: 'var(--bde-warning)',
  red: 'var(--bde-danger)'
}

const ACCENT_SURFACE_MAP: Record<NeonAccent, string> = {
  cyan: 'var(--bde-accent-surface)',
  pink: 'var(--bde-accent-surface)',
  blue: 'var(--bde-accent-surface)',
  purple: 'var(--bde-accent-surface)',
  orange: 'var(--bde-warning-surface)',
  red: 'var(--bde-danger-surface)'
}

const ACCENT_BORDER_MAP: Record<NeonAccent, string> = {
  cyan: 'var(--bde-accent-border)',
  pink: 'var(--bde-accent-border)',
  blue: 'var(--bde-accent-border)',
  purple: 'var(--bde-accent-border)',
  orange: 'var(--bde-warning-border)',
  red: 'var(--bde-danger-border)'
}

/** Maps a NeonAccent name to its CSS custom property values */
export function neonVar(
  accent: NeonAccent,
  variant: 'color' | 'glow' | 'surface' | 'border'
): string {
  switch (variant) {
    case 'color':
      return ACCENT_COLOR_MAP[accent]
    case 'glow':
      return 'transparent'
    case 'surface':
      return ACCENT_SURFACE_MAP[accent]
    case 'border':
      return ACCENT_BORDER_MAP[accent]
  }
}

/** All accent names for iteration */
export const NEON_ACCENTS: NeonAccent[] = ['cyan', 'pink', 'blue', 'purple', 'orange', 'red']
