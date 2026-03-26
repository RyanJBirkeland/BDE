/**
 * AppearanceSection — theme toggle and accent color picker tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSetTheme = vi.fn()
let mockTheme = 'dark'

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: mockTheme, toggleTheme: vi.fn(), setTheme: mockSetTheme })
  )
}))

import { AppearanceSection } from '../AppearanceSection'

describe('AppearanceSection', () => {
  beforeEach(() => {
    mockSetTheme.mockReset()
    mockTheme = 'dark'
    localStorage.clear()
    document.documentElement.style.removeProperty('--bde-accent')
  })

  it('renders section heading', () => {
    render(<AppearanceSection />)
    expect(screen.getByText('Appearance')).toBeInTheDocument()
  })

  it('renders theme toggle buttons', () => {
    render(<AppearanceSection />)
    expect(screen.getByText('Theme')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
  })

  it('renders accent color options', () => {
    render(<AppearanceSection />)
    expect(screen.getByText('Accent Color')).toBeInTheDocument()
    expect(screen.getByTitle('Green')).toBeInTheDocument()
    expect(screen.getByTitle('Blue')).toBeInTheDocument()
    expect(screen.getByTitle('Purple')).toBeInTheDocument()
    expect(screen.getByTitle('Orange')).toBeInTheDocument()
    expect(screen.getByTitle('Red')).toBeInTheDocument()
    expect(screen.getByTitle('White')).toBeInTheDocument()
  })

  it('clicking Dark button calls setTheme with dark', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    await user.click(screen.getByRole('button', { name: 'Dark' }))
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('clicking Light button calls setTheme with light', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })

  it('dark theme button has primary class when theme is dark', () => {
    render(<AppearanceSection />)
    const darkBtn = screen.getByRole('button', { name: 'Dark' })
    expect(darkBtn.className).toContain('bde-btn--primary')
    const lightBtn = screen.getByRole('button', { name: 'Light' })
    expect(lightBtn.className).toContain('bde-btn--ghost')
  })

  it('light theme button has primary class when theme is light', async () => {
    mockTheme = 'light'
    const { useThemeStore } = await import('../../../stores/theme')
    vi.mocked(useThemeStore).mockImplementation((selector) =>
      (selector as unknown as (s: Record<string, unknown>) => unknown)({
        theme: 'light',
        toggleTheme: vi.fn(),
        setTheme: mockSetTheme
      })
    )
    render(<AppearanceSection />)
    const lightBtn = screen.getByRole('button', { name: 'Light' })
    expect(lightBtn.className).toContain('bde-btn--primary')
    const darkBtn = screen.getByRole('button', { name: 'Dark' })
    expect(darkBtn.className).toContain('bde-btn--ghost')
  })

  it('clicking an accent color updates localStorage and CSS custom property', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    await user.click(screen.getByTitle('Blue'))
    expect(localStorage.getItem('bde-accent')).toBe('#3B82F6')
    expect(document.documentElement.style.getPropertyValue('--bde-accent')).toBe('#3B82F6')
  })

  it('clicking a different accent color updates to that color', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    await user.click(screen.getByTitle('Purple'))
    expect(localStorage.getItem('bde-accent')).toBe('#8B5CF6')
  })

  it('default accent is Green when localStorage is empty', () => {
    render(<AppearanceSection />)
    const greenBtn = screen.getByTitle('Green')
    expect(greenBtn.className).toContain('settings-color--active')
  })

  it('loads saved accent from localStorage on mount', () => {
    localStorage.setItem('bde-accent', '#EF4444')
    render(<AppearanceSection />)
    const redBtn = screen.getByTitle('Red')
    expect(redBtn.className).toContain('settings-color--active')
    expect(document.documentElement.style.getPropertyValue('--bde-accent')).toBe('#EF4444')
  })

  it('active accent swatch has settings-color--active class, others do not', async () => {
    const user = userEvent.setup()
    render(<AppearanceSection />)
    await user.click(screen.getByTitle('Orange'))
    const orangeBtn = screen.getByTitle('Orange')
    expect(orangeBtn.className).toContain('settings-color--active')
    const greenBtn = screen.getByTitle('Green')
    expect(greenBtn.className).not.toContain('settings-color--active')
  })

  it('all 6 accent buttons are rendered', () => {
    render(<AppearanceSection />)
    const colorButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.className.includes('settings-color'))
    expect(colorButtons).toHaveLength(6)
  })
})
