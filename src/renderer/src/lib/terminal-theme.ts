import type { ITheme } from 'xterm'

/**
 * Build an xterm ITheme from the currently-active CSS variables.
 * Must be called after DOM is mounted (uses getComputedStyle).
 */
export function getTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string): string => style.getPropertyValue(v).trim()

  return {
    background: get('--fleet-bg'),
    foreground: get('--fleet-text'),
    cursor: get('--fleet-accent'),
    cursorAccent: get('--fleet-bg'),
    selectionBackground: get('--fleet-accent-dim'),
    selectionForeground: get('--fleet-text'),
    black: get('--fleet-surface'),
    brightBlack: get('--fleet-text-dim'),
    red: get('--fleet-danger'),
    brightRed: get('--fleet-danger-text'),
    green: get('--fleet-success'),
    brightGreen: get('--fleet-accent'),
    yellow: get('--fleet-warning'),
    brightYellow: get('--fleet-warning'),
    blue: get('--fleet-info'),
    brightBlue: get('--fleet-info'),
    magenta: get('--fleet-purple'),
    brightMagenta: get('--fleet-subagent'),
    cyan: get('--fleet-info'),
    brightCyan: get('--fleet-info'),
    white: get('--fleet-text'),
    brightWhite: get('--fleet-text')
  }
}
