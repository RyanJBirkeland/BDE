import type { ITheme } from 'xterm'

/**
 * Build an xterm ITheme from the currently-active CSS variables.
 * Must be called after DOM is mounted (uses getComputedStyle).
 */
export function getTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string): string => style.getPropertyValue(v).trim()

  return {
    background: get('--bde-bg'),
    foreground: get('--bde-text'),
    cursor: get('--bde-accent'),
    cursorAccent: get('--bde-bg'),
    selectionBackground: get('--bde-accent-dim'),
    selectionForeground: get('--bde-text'),
    black: get('--bde-surface'),
    brightBlack: get('--bde-text-dim'),
    red: get('--bde-danger'),
    brightRed: get('--bde-danger-text'),
    green: get('--bde-success'),
    brightGreen: get('--bde-accent'),
    yellow: get('--bde-warning'),
    brightYellow: get('--bde-warning'),
    blue: get('--bde-info'),
    brightBlue: get('--bde-info'),
    magenta: get('--bde-purple'),
    brightMagenta: get('--bde-subagent'),
    cyan: get('--bde-info'),
    brightCyan: get('--bde-info'),
    white: get('--bde-text'),
    brightWhite: get('--bde-text'),
  }
}
