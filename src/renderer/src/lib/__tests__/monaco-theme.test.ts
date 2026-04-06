import { describe, it, expect } from 'vitest'
import { getMonacoTheme, getLightMonacoTheme } from '../monaco-theme'

describe('monaco-theme', () => {
  describe('getMonacoTheme', () => {
    it('returns a dark theme with vs-dark base', () => {
      const theme = getMonacoTheme()
      expect(theme.base).toBe('vs-dark')
      expect(theme.inherit).toBe(true)
    })

    it('has syntax highlighting rules', () => {
      const theme = getMonacoTheme()
      expect(theme.rules.length).toBeGreaterThan(0)
      expect(theme.rules.find((r) => r.token === 'keyword')).toBeDefined()
      expect(theme.rules.find((r) => r.token === 'string')).toBeDefined()
      expect(theme.rules.find((r) => r.token === 'comment')).toBeDefined()
    })

    it('has editor colors', () => {
      const theme = getMonacoTheme()
      expect(theme.colors).toBeDefined()
      expect(theme.colors['editor.background']).toBeDefined()
      expect(theme.colors['editor.foreground']).toBeDefined()
    })
  })

  describe('getLightMonacoTheme', () => {
    it('returns a light theme with vs base', () => {
      const theme = getLightMonacoTheme()
      expect(theme.base).toBe('vs')
      expect(theme.inherit).toBe(true)
    })

    it('has syntax highlighting rules', () => {
      const theme = getLightMonacoTheme()
      expect(theme.rules.length).toBeGreaterThan(0)
    })

    it('has editor colors', () => {
      const theme = getLightMonacoTheme()
      expect(theme.colors).toBeDefined()
      expect(theme.colors['editor.background']).toBeDefined()
    })
  })
})
