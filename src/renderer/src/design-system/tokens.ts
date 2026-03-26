/**
 * Design system tokens — single source of truth for all visual constants.
 * Import `tokens` and reference values instead of hardcoding colors, sizes, etc.
 * These tokens define the dark theme defaults; the light theme overrides colors
 * via CSS variables toggled by the theme store.
 */
export const tokens = {
  /**
   * Color palette — resolved via CSS custom properties so they
   * automatically adapt to the active theme (dark / light).
   * Use these values in React inline `style` props; CSS-class-based
   * styling should reference `var(--bde-*)` directly.
   */
  color: {
    bg: 'var(--bde-bg)',
    surface: 'var(--bde-surface)',
    surfaceHigh: 'var(--bde-surface-high)',
    border: 'var(--bde-border)',
    borderHover: 'var(--bde-border-hover)',
    accent: 'var(--bde-accent)',
    accentDim: 'var(--bde-accent-dim)',
    text: 'var(--bde-text)',
    textMuted: 'var(--bde-text-muted)',
    textDim: 'var(--bde-text-dim)',
    danger: 'var(--bde-danger)',
    dangerDim: 'var(--bde-danger-dim)',
    warning: 'var(--bde-warning)',
    warningDim: 'var(--bde-warning-dim)',
    info: 'var(--bde-info)',
    infoDim: 'var(--bde-info-dim)',
    success: 'var(--bde-success)',
  },
  /** Font stacks */
  font: {
    ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', // UI text
    code: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace', // Code / monospace
  },
  /** Font sizes — use semantic names, not raw px */
  size: {
    xs: '11px',   // Badges, fine print
    sm: '12px',   // Secondary labels
    md: '13px',   // Default body text
    lg: '14px',   // Headings, emphasis
    xl: '16px',   // Section titles
    xxl: '20px',  // Page titles
  },
  /** Spacing scale (4px base) */
  space: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
  },
  /** Border radius */
  radius: {
    sm: '4px',    // Buttons, inputs
    md: '6px',    // Cards
    lg: '8px',    // Panels
    xl: '12px',   // Modals
    full: '9999px', // Pills, avatars
  },
  /** Box shadows — increasing elevation (theme-aware via CSS variables) */
  shadow: {
    sm: 'var(--bde-shadow-sm)',
    md: 'var(--bde-shadow-md)',
    lg: 'var(--bde-shadow-lg)',
  },
  /** Transition durations */
  transition: {
    fast: '100ms ease',   // Hover states, toggles
    base: '150ms ease',   // General interactions
    slow: '200ms ease',   // Panel slides, fades
  },
  neon: {
    cyan: 'var(--neon-cyan)',
    pink: 'var(--neon-pink)',
    blue: 'var(--neon-blue)',
    purple: 'var(--neon-purple)',
    orange: 'var(--neon-orange)',
    red: 'var(--neon-red)',
    bg: 'var(--neon-bg)',
    glassBg: 'var(--neon-glass-blur)',
    glassEdge: 'var(--neon-glass-edge)',
    glassShadow: 'var(--neon-glass-shadow)',
    text: 'var(--neon-text)',
    textMuted: 'var(--neon-text-muted)',
    textDim: 'var(--neon-text-dim)',
    surfaceDim: 'var(--neon-surface-dim)',
    surfaceSubtle: 'var(--neon-surface-subtle)',
    surfaceDeep: 'var(--neon-surface-deep)',
  },
}
