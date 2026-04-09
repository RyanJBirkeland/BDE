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
    accentSurface: 'var(--bde-accent-surface)',
    accentBorder: 'var(--bde-accent-border)',
    text: 'var(--bde-text)',
    textMuted: 'var(--bde-text-muted)',
    textDim: 'var(--bde-text-dim)',
    danger: 'var(--bde-danger)',
    dangerDim: 'var(--bde-danger-dim)',
    dangerSurface: 'var(--bde-danger-surface)',
    dangerBorder: 'var(--bde-danger-border)',
    warning: 'var(--bde-warning)',
    warningDim: 'var(--bde-warning-dim)',
    warningSurface: 'var(--bde-warning-surface)',
    warningBorder: 'var(--bde-warning-border)',
    info: 'var(--bde-info)',
    infoDim: 'var(--bde-info-dim)',
    success: 'var(--bde-success)'
  },
  status: {
    active: 'var(--bde-status-active)',
    review: 'var(--bde-status-review)',
    blocked: 'var(--bde-warning)',
    done: 'var(--bde-status-done)',
    queued: 'var(--bde-accent)',
    failed: 'var(--bde-danger)',
    cancelled: 'var(--bde-text-dim)'
  },
  /** Font stacks */
  font: {
    ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', // UI text
    code: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace' // Code / monospace
  },
  /** Font sizes — use semantic names, not raw px */
  size: {
    '2xs': '10px', // Tiny labels, metadata
    xs: '11px', // Badges, fine print
    sm: '12px', // Secondary labels
    md: '13px', // Default body text
    lg: '14px', // Headings, emphasis
    xl: '16px', // Section titles
    xxl: '20px' // Page titles
  },
  /** Spacing scale (4px base) */
  space: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px'
  },
  /** Border radius */
  radius: {
    sm: '4px', // Buttons, inputs
    md: '6px', // Cards
    lg: '8px', // Panels
    xl: '12px', // Modals
    full: '9999px' // Pills, avatars
  },
  /** Box shadows — increasing elevation (theme-aware via CSS variables) */
  shadow: {
    sm: 'var(--bde-shadow-sm)',
    md: 'var(--bde-shadow-md)',
    lg: 'var(--bde-shadow-lg)'
  },
  /** Transition durations */
  transition: {
    fast: '100ms ease', // Hover states, toggles
    base: '150ms ease', // General interactions
    slow: '200ms ease' // Panel slides, fades
  },
}
