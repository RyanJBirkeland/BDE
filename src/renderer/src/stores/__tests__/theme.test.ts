import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useThemeStore } from '../theme'

describe('theme store', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    localStorage.clear()
    document.documentElement.classList.remove(
      'theme-light',
      'theme-warm',
      'theme-pro-dark',
      'theme-pro-light'
    )
  })

  it('setTheme to dark updates state', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('setTheme to light updates state', () => {
    useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('setTheme persists to localStorage', () => {
    useThemeStore.getState().setTheme('light')
    expect(localStorage.getItem('bde-theme')).toBe('light')
  })

  it('setTheme dark applies the pro-dark class (default Dark = pro-dark)', () => {
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-pro-light')).toBe(false)
  })

  it('setTheme light applies the pro-light class (default Light = pro-light)', () => {
    useThemeStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('theme-pro-light')).toBe(true)
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(false)
    expect(document.documentElement.classList.contains('theme-warm')).toBe(false)
  })

  it('setTheme dark removes any pre-existing theme classes', () => {
    document.documentElement.classList.add('theme-light', 'theme-warm', 'theme-pro-light')
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-warm')).toBe(false)
    expect(document.documentElement.classList.contains('theme-pro-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
  })

  it('toggleTheme cycles system → dark', () => {
    useThemeStore.setState({ theme: 'system' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('toggleTheme cycles dark → light', () => {
    useThemeStore.setState({ theme: 'dark' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('toggleTheme cycles light → system (full loop)', () => {
    useThemeStore.setState({ theme: 'light' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('system')
  })

  it('responds to storage events for cross-window sync (dark)', () => {
    const event = new StorageEvent('storage', {
      key: 'bde-theme',
      newValue: 'dark'
    })
    window.dispatchEvent(event)
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
  })

  it('storage event with legacy warm value migrates to dark', () => {
    const event = new StorageEvent('storage', {
      key: 'bde-theme',
      newValue: 'warm'
    })
    window.dispatchEvent(event)
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
  })

  it('storage event with legacy pro-dark value migrates to dark', () => {
    const event = new StorageEvent('storage', {
      key: 'bde-theme',
      newValue: 'pro-dark'
    })
    window.dispatchEvent(event)
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
  })

  it('storage event with legacy pro-light value migrates to light', () => {
    const event = new StorageEvent('storage', {
      key: 'bde-theme',
      newValue: 'pro-light'
    })
    window.dispatchEvent(event)
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('theme-pro-light')).toBe(true)
  })

  it('ignores storage events for other keys', () => {
    useThemeStore.setState({ theme: 'dark' })
    const event = new StorageEvent('storage', {
      key: 'other-key',
      newValue: 'light'
    })
    window.dispatchEvent(event)
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('ignores storage events with null value', () => {
    useThemeStore.setState({ theme: 'dark' })
    const event = new StorageEvent('storage', {
      key: 'bde-theme',
      newValue: null
    })
    window.dispatchEvent(event)
    expect(useThemeStore.getState().theme).toBe('dark')
  })
})

describe('theme store — system preference', () => {
  let mqList: Array<{
    query: string
    matches: boolean
    listeners: Array<() => void>
  }>

  beforeEach(() => {
    mqList = []
    // Provide a controllable matchMedia mock so we can flip prefers-color-scheme.
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => {
        const entry = {
          query,
          matches: query.includes('dark'),
          media: query,
          onchange: null,
          listeners: [] as Array<() => void>,
          addEventListener: function (_: string, cb: () => void) {
            this.listeners.push(cb)
          },
          removeEventListener: function (_: string, cb: () => void) {
            this.listeners = this.listeners.filter((l) => l !== cb)
          },
          addListener: function (cb: () => void) {
            this.listeners.push(cb)
          },
          removeListener: function (cb: () => void) {
            this.listeners = this.listeners.filter((l) => l !== cb)
          },
          dispatchEvent: () => true
        }
        mqList.push(entry)
        return entry as unknown as MediaQueryList
      })
    )
    localStorage.clear()
    document.documentElement.classList.remove(
      'theme-light',
      'theme-warm',
      'theme-pro-dark',
      'theme-pro-light'
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('setTheme system applies pro-dark when OS prefers dark', () => {
    useThemeStore.getState().setTheme('system')
    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
  })

  it('setTheme system applies pro-light when OS prefers light', () => {
    // Override the mock so the dark query reports false
    mqList.length = 0
    vi.stubGlobal(
      'matchMedia',
      vi.fn(
        (query: string) =>
          ({
            query,
            matches: false, // OS prefers light
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => true
          }) as unknown as MediaQueryList
      )
    )
    useThemeStore.getState().setTheme('system')
    expect(document.documentElement.classList.contains('theme-pro-light')).toBe(true)
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(false)
  })

  it('setTheme system persists "system" to localStorage (not the resolved value)', () => {
    useThemeStore.getState().setTheme('system')
    expect(localStorage.getItem('bde-theme')).toBe('system')
  })
})
