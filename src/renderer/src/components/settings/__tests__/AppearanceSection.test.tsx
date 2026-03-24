/**
 * AppearanceSection — theme toggle and accent color picker tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'dark', toggleTheme: vi.fn(), setTheme: vi.fn() })
  ),
}))

import { AppearanceSection } from '../AppearanceSection'

describe('AppearanceSection', () => {
  it('renders theme toggle buttons', () => {
    render(<AppearanceSection />)
    expect(screen.getByText('Theme')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
  })

  it('renders accent color options', () => {
    render(<AppearanceSection />)
    expect(screen.getByText('Accent Color')).toBeInTheDocument()
    // 6 color preset buttons with title attributes
    expect(screen.getByTitle('Green')).toBeInTheDocument()
    expect(screen.getByTitle('Blue')).toBeInTheDocument()
    expect(screen.getByTitle('Purple')).toBeInTheDocument()
    expect(screen.getByTitle('Orange')).toBeInTheDocument()
    expect(screen.getByTitle('Red')).toBeInTheDocument()
    expect(screen.getByTitle('White')).toBeInTheDocument()
  })

  it('clicking a theme button calls setTheme', async () => {
    const user = userEvent.setup()
    const setTheme = vi.fn()
    const { useThemeStore } = await import('../../../stores/theme')
    vi.mocked(useThemeStore).mockImplementation((selector) =>
      (selector as unknown as (s: Record<string, unknown>) => unknown)({ theme: 'dark', toggleTheme: vi.fn(), setTheme })
    )
    render(<AppearanceSection />)
    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(setTheme).toHaveBeenCalledWith('light')
  })
})
