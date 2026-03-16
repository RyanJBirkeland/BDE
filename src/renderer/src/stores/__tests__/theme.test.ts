import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThemeStore } from '../theme'

describe('theme store', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    localStorage.clear()
    document.documentElement.classList.remove('theme-light')
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

  it('toggleTheme flips light to dark', () => {
    useThemeStore.setState({ theme: 'light' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })
})
