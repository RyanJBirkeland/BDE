// src/renderer/src/components/neon/types.ts

export type NeonAccent = 'cyan' | 'pink' | 'blue' | 'purple' | 'orange' | 'red'

/** Maps a NeonAccent to its --fleet-* CSS custom property */
const ACCENT_COLOR_MAP: Record<NeonAccent, string> = {
  cyan: 'var(--fleet-accent)',
  pink: 'var(--fleet-status-done)',
  blue: 'var(--fleet-status-review)',
  purple: 'var(--fleet-status-active)',
  orange: 'var(--fleet-warning)',
  red: 'var(--fleet-danger)'
}

const ACCENT_SURFACE_MAP: Record<NeonAccent, string> = {
  cyan: 'var(--fleet-accent-surface)',
  pink: 'var(--fleet-accent-surface)',
  blue: 'var(--fleet-accent-surface)',
  purple: 'var(--fleet-accent-surface)',
  orange: 'var(--fleet-warning-surface)',
  red: 'var(--fleet-danger-surface)'
}

const ACCENT_BORDER_MAP: Record<NeonAccent, string> = {
  cyan: 'var(--fleet-accent-border)',
  pink: 'var(--fleet-accent-border)',
  blue: 'var(--fleet-accent-border)',
  purple: 'var(--fleet-accent-border)',
  orange: 'var(--fleet-warning-border)',
  red: 'var(--fleet-danger-border)'
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
