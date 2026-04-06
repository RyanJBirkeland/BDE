import { render, screen, fireEvent } from '@testing-library/react'
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
      activeView: 'dashboard',
      closeTab: vi.fn(),
      setActiveTab: vi.fn(),
      setView: vi.fn()
    })
  ),
  findLeaf: vi.fn((_root: any, panelId: string) => (panelId === 'p1' ? mockLeaf : null))
}))

vi.mock('../../../stores/costData', () => ({
  useCostDataStore: vi.fn((sel: any) => sel({ totalCost: 4.2 }))
}))

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((sel: any) => sel({ theme: 'dark', toggleTheme: vi.fn() }))
}))

let mockTasks: Array<{ id: string; status: string }> = []
vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: any) => sel({ tasks: mockTasks }))
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

  it('renders Sun icon in dark theme', async () => {
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    // In dark mode, Sun icon is shown (to switch to light)
    const btn = screen.getByLabelText('Toggle theme')
    expect(btn).toBeInTheDocument()
  })

  it('renders Moon icon in light theme', async () => {
    const themeModule = await import('../../../stores/theme')
    vi.mocked(themeModule.useThemeStore).mockImplementation((sel: any) =>
      sel({ theme: 'light', toggleTheme: vi.fn() })
    )
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument()
  })

  it('renders logo that navigates to dashboard on click', async () => {
    const panelModule = await import('../../../stores/panelLayout')
    const mockSetView = vi.fn()
    vi.mocked(panelModule.usePanelLayoutStore).mockImplementation((sel: any) =>
      sel({
        root: mockLeaf,
        focusedPanelId: 'p1',
        activeView: 'dashboard',
        closeTab: vi.fn(),
        setActiveTab: vi.fn(),
        setView: mockSetView
      })
    )
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    fireEvent.click(screen.getByText('B'))
    expect(mockSetView).toHaveBeenCalledWith('dashboard')
  })

  it('handles null focusedPanelId with empty tabs', async () => {
    const panelModule = await import('../../../stores/panelLayout')
    vi.mocked(panelModule.usePanelLayoutStore).mockImplementation((sel: any) =>
      sel({
        root: mockLeaf,
        focusedPanelId: null,
        activeView: 'dashboard',
        closeTab: vi.fn(),
        setActiveTab: vi.fn(),
        setView: vi.fn()
      })
    )
    vi.mocked(panelModule.findLeaf).mockReturnValue(null)
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    // No tabs should render but no crash
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  describe('health strip', () => {
    it('renders active/queued counts and omits failed pill when zero', async () => {
      mockTasks = [
        { id: '1', status: 'active' },
        { id: '2', status: 'active' },
        { id: '3', status: 'queued' },
        { id: '4', status: 'queued' },
        { id: '5', status: 'queued' },
        { id: '6', status: 'done' }
      ]
      const { UnifiedHeader } = await import('../UnifiedHeader')
      render(<UnifiedHeader />)
      expect(screen.getByTestId('health-strip-active')).toHaveTextContent('2')
      expect(screen.getByTestId('health-strip-queued')).toHaveTextContent('3')
      expect(screen.queryByTestId('health-strip-failed')).toBeNull()
      expect(screen.getByTestId('health-strip-dot')).toHaveAttribute('data-state', 'running')
      mockTasks = []
    })

    it('renders failed count and sets dot to error state when any task failed', async () => {
      mockTasks = [
        { id: '1', status: 'failed' },
        { id: '2', status: 'error' }
      ]
      const { UnifiedHeader } = await import('../UnifiedHeader')
      render(<UnifiedHeader />)
      expect(screen.getByTestId('health-strip-failed')).toHaveTextContent('!2')
      expect(screen.getByTestId('health-strip-dot')).toHaveAttribute('data-state', 'error')
      mockTasks = []
    })

    it('shows idle dot state when no active/failed tasks', async () => {
      mockTasks = [{ id: '1', status: 'done' }]
      const { UnifiedHeader } = await import('../UnifiedHeader')
      render(<UnifiedHeader />)
      expect(screen.getByTestId('health-strip-dot')).toHaveAttribute('data-state', 'idle')
      mockTasks = []
    })

    it('navigates to sprint pipeline on click', async () => {
      const panelModule = await import('../../../stores/panelLayout')
      const mockSetView = vi.fn()
      vi.mocked(panelModule.usePanelLayoutStore).mockImplementation((sel: any) =>
        sel({
          root: mockLeaf,
          focusedPanelId: 'p1',
          activeView: 'dashboard',
          closeTab: vi.fn(),
          setActiveTab: vi.fn(),
          setView: mockSetView
        })
      )
      vi.mocked(panelModule.findLeaf).mockReturnValue(mockLeaf)
      mockTasks = [{ id: '1', status: 'active' }]
      const { UnifiedHeader } = await import('../UnifiedHeader')
      render(<UnifiedHeader />)
      fireEvent.click(screen.getByTestId('unified-header-health-strip'))
      expect(mockSetView).toHaveBeenCalledWith('sprint')
      mockTasks = []
    })
  })

  it('renders multiple tabs with correct active state', async () => {
    // Re-mock to restore tab state after null focusedPanelId test
    const panelModule = await import('../../../stores/panelLayout')
    vi.mocked(panelModule.usePanelLayoutStore).mockImplementation((sel: any) =>
      sel({
        root: mockLeaf,
        focusedPanelId: 'p1',
        activeView: 'dashboard',
        closeTab: vi.fn(),
        setActiveTab: vi.fn(),
        setView: vi.fn()
      })
    )
    vi.mocked(panelModule.findLeaf).mockReturnValue(mockLeaf)
    const { UnifiedHeader } = await import('../UnifiedHeader')
    render(<UnifiedHeader />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('IDE')).toBeInTheDocument()
  })
})
