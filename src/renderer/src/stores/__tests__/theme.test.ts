import { describe, it, expect, beforeEach } from 'vitest'
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

  it('setTheme light adds theme-light class to document', () => {
    useThemeStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
  })

  it('setTheme dark removes theme-light class', () => {
    document.documentElement.classList.add('theme-light')
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
  })

  it('toggleTheme flips dark to light', () => {
    useThemeStore.setState({ theme: 'dark' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('toggleTheme cycles light to warm', () => {
    useThemeStore.setState({ theme: 'light' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('warm')
  })

  it('toggleTheme cycles warm to pro-dark', () => {
    useThemeStore.setState({ theme: 'warm' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('pro-dark')
  })

  it('setTheme to warm updates state', () => {
    useThemeStore.getState().setTheme('warm')
    expect(useThemeStore.getState().theme).toBe('warm')
  })

  it('setTheme warm adds theme-warm class to document', () => {
    useThemeStore.getState().setTheme('warm')
    expect(document.documentElement.classList.contains('theme-warm')).toBe(true)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
  })

  it('setTheme warm persists to localStorage', () => {
    useThemeStore.getState().setTheme('warm')
    expect(localStorage.getItem('bde-theme')).toBe('warm')
  })

  it('setTheme to pro-dark updates state', () => {
    useThemeStore.getState().setTheme('pro-dark')
    expect(useThemeStore.getState().theme).toBe('pro-dark')
  })

  it('setTheme to pro-light updates state', () => {
    useThemeStore.getState().setTheme('pro-light')
    expect(useThemeStore.getState().theme).toBe('pro-light')
  })

  it('setTheme pro-dark adds correct class and removes others', () => {
    document.documentElement.classList.add('theme-light')
    useThemeStore.getState().setTheme('pro-dark')
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(true)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-warm')).toBe(false)
  })

  it('setTheme pro-light adds correct class and removes others', () => {
    document.documentElement.classList.add('theme-warm')
    useThemeStore.getState().setTheme('pro-light')
    expect(document.documentElement.classList.contains('theme-pro-light')).toBe(true)
    expect(document.documentElement.classList.contains('theme-warm')).toBe(false)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
  })

  it('setTheme pro-dark persists to localStorage', () => {
    useThemeStore.getState().setTheme('pro-dark')
    expect(localStorage.getItem('bde-theme')).toBe('pro-dark')
  })

  it('toggleTheme cycles pro-dark to pro-light', () => {
    useThemeStore.setState({ theme: 'pro-dark' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('pro-light')
  })

  it('toggleTheme cycles pro-light to dark', () => {
    useThemeStore.setState({ theme: 'pro-light' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('setTheme dark removes all theme classes', () => {
    document.documentElement.classList.add('theme-light', 'theme-warm', 'theme-pro-dark', 'theme-pro-light')
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-warm')).toBe(false)
    expect(document.documentElement.classList.contains('theme-pro-dark')).toBe(false)
    expect(document.documentElement.classList.contains('theme-pro-light')).toBe(false)
  })

  it('responds to storage events for cross-window sync', () => {
    // Simulate a storage event from another window
    const event = new StorageEvent('storage', {
      key: 'bde-theme',
      newValue: 'warm'
    })
    window.dispatchEvent(event)
    expect(useThemeStore.getState().theme).toBe('warm')
    expect(document.documentElement.classList.contains('theme-warm')).toBe(true)
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
