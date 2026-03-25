// src/renderer/src/components/neon/types.ts

export type NeonAccent = 'cyan' | 'pink' | 'blue' | 'purple' | 'orange' | 'red';

/** Maps a NeonAccent name to its CSS custom property values */
export function neonVar(accent: NeonAccent, variant: 'color' | 'glow' | 'surface' | 'border'): string {
  const varMap = {
    color: `var(--neon-${accent})`,
    glow: `var(--neon-${accent}-glow)`,
    surface: `var(--neon-${accent}-surface)`,
    border: `var(--neon-${accent}-border)`,
  };
  return varMap[variant];
}

/** All accent names for iteration */
export const NEON_ACCENTS: NeonAccent[] = ['cyan', 'pink', 'blue', 'purple', 'orange', 'red'];
