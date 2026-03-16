/**
 * Design system tokens — single source of truth for all visual constants.
 * Import `tokens` and reference values instead of hardcoding colors, sizes, etc.
 * These tokens define the dark theme defaults; the light theme overrides colors
 * via CSS variables toggled by the theme store.
 */
export const tokens = {
  /** Color palette — dark theme defaults */
  color: {
    bg: '#0A0A0A',              // App background
    surface: '#141414',          // Card / panel background
    surfaceHigh: '#1E1E1E',      // Elevated surface (modals, popovers)
    border: '#333333',           // Default border
    borderHover: '#444444',      // Border on hover/focus
    accent: '#00D37F',           // Primary accent (green)
    accentDim: 'rgba(0, 211, 127, 0.15)', // Accent background tint
    text: '#E8E8E8',             // Primary text
    textMuted: '#888888',        // Secondary text
    textDim: '#555555',          // Tertiary / disabled text
    danger: '#FF4D4D',           // Error / destructive actions
    dangerDim: 'rgba(255, 77, 77, 0.15)', // Danger background tint
    warning: '#F59E0B',          // Warning indicators
    info: '#3B82F6',             // Informational highlights
    success: '#00D37F',          // Success indicators (same as accent)
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
  /** Box shadows — increasing elevation */
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.4)',
    md: '0 4px 12px rgba(0,0,0,0.5)',
    lg: '0 16px 48px rgba(0,0,0,0.6)',
  },
  /** Transition durations */
  transition: {
    fast: '100ms ease',   // Hover states, toggles
    base: '150ms ease',   // General interactions
    slow: '200ms ease',   // Panel slides, fades
  },
}
