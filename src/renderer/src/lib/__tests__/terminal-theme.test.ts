import { describe, it, expect, beforeEach } from 'vitest'
import { getTerminalTheme } from '../terminal-theme'

describe('getTerminalTheme', () => {
  beforeEach(() => {
    // Set CSS custom properties on documentElement so getComputedStyle returns them
    const root = document.documentElement
    root.style.setProperty('--bde-bg', '#1a1a2e')
    root.style.setProperty('--bde-text', '#eaeaea')
    root.style.setProperty('--bde-accent', '#00d4ff')
    root.style.setProperty('--bde-accent-dim', '#003344')
    root.style.setProperty('--bde-surface', '#222240')
    root.style.setProperty('--bde-text-dim', '#888888')
    root.style.setProperty('--bde-danger', '#ff3366')
    root.style.setProperty('--bde-danger-text', '#ff6688')
    root.style.setProperty('--bde-success', '#00ff88')
    root.style.setProperty('--bde-warning', '#ffaa00')
    root.style.setProperty('--bde-info', '#3399ff')
    root.style.setProperty('--bde-purple', '#aa66ff')
    root.style.setProperty('--bde-subagent', '#cc88ff')
  })

  it('returns a valid ITheme object with all required color keys', () => {
    const theme = getTerminalTheme()

    expect(theme).toHaveProperty('background')
    expect(theme).toHaveProperty('foreground')
    expect(theme).toHaveProperty('cursor')
    expect(theme).toHaveProperty('cursorAccent')
    expect(theme).toHaveProperty('selectionBackground')
    expect(theme).toHaveProperty('selectionForeground')
    expect(theme).toHaveProperty('black')
    expect(theme).toHaveProperty('brightBlack')
    expect(theme).toHaveProperty('red')
    expect(theme).toHaveProperty('brightRed')
    expect(theme).toHaveProperty('green')
    expect(theme).toHaveProperty('brightGreen')
    expect(theme).toHaveProperty('yellow')
    expect(theme).toHaveProperty('brightYellow')
    expect(theme).toHaveProperty('blue')
    expect(theme).toHaveProperty('brightBlue')
    expect(theme).toHaveProperty('magenta')
    expect(theme).toHaveProperty('brightMagenta')
    expect(theme).toHaveProperty('cyan')
    expect(theme).toHaveProperty('brightCyan')
    expect(theme).toHaveProperty('white')
    expect(theme).toHaveProperty('brightWhite')
  })

  it('maps CSS variables to correct theme keys', () => {
    const theme = getTerminalTheme()

    expect(theme.background).toBe('#1a1a2e')
    expect(theme.foreground).toBe('#eaeaea')
    expect(theme.cursor).toBe('#00d4ff')
    expect(theme.cursorAccent).toBe('#1a1a2e')
    expect(theme.selectionBackground).toBe('#003344')
    expect(theme.selectionForeground).toBe('#eaeaea')
    expect(theme.black).toBe('#222240')
    expect(theme.brightBlack).toBe('#888888')
    expect(theme.red).toBe('#ff3366')
    expect(theme.brightRed).toBe('#ff6688')
    expect(theme.green).toBe('#00ff88')
    expect(theme.brightGreen).toBe('#00d4ff')
    expect(theme.yellow).toBe('#ffaa00')
    expect(theme.brightYellow).toBe('#ffaa00')
    expect(theme.blue).toBe('#3399ff')
    expect(theme.brightBlue).toBe('#3399ff')
    expect(theme.magenta).toBe('#aa66ff')
    expect(theme.brightMagenta).toBe('#cc88ff')
    expect(theme.cyan).toBe('#3399ff')
    expect(theme.brightCyan).toBe('#3399ff')
    expect(theme.white).toBe('#eaeaea')
    expect(theme.brightWhite).toBe('#eaeaea')
  })

  it('returns empty strings for unset CSS variables', () => {
    // Clear all properties
    const root = document.documentElement
    root.style.cssText = ''

    const theme = getTerminalTheme()
    // getComputedStyle returns '' for unset custom properties
    expect(theme.background).toBe('')
    expect(theme.foreground).toBe('')
  })
})
