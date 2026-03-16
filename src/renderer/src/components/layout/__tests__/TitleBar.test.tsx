import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TitleBar } from '../TitleBar'

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: { repoFilter: string; setRepoFilter: () => void }) => unknown) =>
    selector({ repoFilter: 'all', setRepoFilter: vi.fn() })
  ),
}))

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((selector: (s: { theme: string; toggleTheme: () => void }) => unknown) =>
    selector({ theme: 'dark', toggleTheme: vi.fn() })
  ),
}))

describe('TitleBar', () => {
  it('renders repo filter select', () => {
    render(<TitleBar sessionCount={0} totalCost={0} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
  })

  it('shows cost display', () => {
    render(<TitleBar sessionCount={0} totalCost={1.5} />)
    expect(screen.getByText('$1.50')).toBeInTheDocument()
  })

  it('shows active badge when sessions > 0', () => {
    render(<TitleBar sessionCount={3} totalCost={0} />)
    expect(screen.getByText('3 active')).toBeInTheDocument()
  })

  it('does not show active badge when sessions = 0', () => {
    render(<TitleBar sessionCount={0} totalCost={0} />)
    expect(screen.queryByText(/active/)).not.toBeInTheDocument()
  })

  it('shows theme toggle button', () => {
    render(<TitleBar sessionCount={0} totalCost={0} />)
    expect(screen.getByTitle('Toggle theme')).toBeInTheDocument()
  })
})
