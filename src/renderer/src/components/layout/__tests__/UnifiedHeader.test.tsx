import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const mockLeaf = {
  type: 'leaf' as const,
  panelId: 'p1',
  tabs: [
    { viewKey: 'dashboard' as const, label: 'Dashboard' },
    { viewKey: 'ide' as const, label: 'IDE' }
  ],
  activeTab: 0
}

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((sel: any) =>
    sel({
      root: mockLeaf,
      focusedPanelId: 'p1',
      closeTab: vi.fn(),
      setActiveTab: vi.fn()
    })
  ),
  findLeaf: vi.fn((_root: any, panelId: string) => (panelId === 'p1' ? mockLeaf : null))
}))

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((sel: any) => sel({ activeView: 'dashboard', setView: vi.fn() }))
}))

vi.mock('../../../stores/costData', () => ({
  useCostDataStore: vi.fn((sel: any) => sel({ totalCost: 4.2 }))
}))

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((sel: any) => sel({ theme: 'dark', toggleTheme: vi.fn() }))
}))

describe('UnifiedHeader', () => {
  it('renders the logo', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('renders tabs for focused panel', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('IDE')).toBeInTheDocument()
  })

  it('renders cost badge', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    expect(screen.getByText('$4.20')).toBeInTheDocument()
  })

  it('renders theme toggle', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument()
  })
})
