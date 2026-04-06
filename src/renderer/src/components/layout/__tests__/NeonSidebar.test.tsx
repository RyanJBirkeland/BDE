// src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  useReducedMotion: () => false
}))

let mockReviewCount = 0
let mockFailedCount = 0

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel?: any) => {
    const tasks = [
      ...Array.from({ length: mockReviewCount }, (_, i) => ({
        id: `r${i}`,
        status: 'review',
        title: `Task ${i}`
      })),
      ...Array.from({ length: mockFailedCount }, (_, i) => ({
        id: `f${i}`,
        status: i % 2 === 0 ? 'failed' : 'error',
        title: `Failed ${i}`
      }))
    ]
    const state = { tasks }
    return sel ? sel(state) : state
  })
}))

vi.mock('../../../stores/sidebar', () => {
  const mockState = {
    pinnedViews: ['dashboard', 'agents', 'ide'],
    pinView: vi.fn(),
    unpinView: vi.fn()
  }

  return {
    useSidebarStore: vi.fn((sel?: any) => (sel ? sel(mockState) : mockState)),
    getUnpinnedViews: vi.fn(() => ['sprint', 'code-review'])
  }
})

vi.mock('../../../stores/panelLayout', () => {
  const mockPanelState = {
    root: {
      type: 'leaf',
      panelId: 'p1',
      tabs: [{ viewKey: 'dashboard', label: 'Dashboard' }],
      activeTab: 0
    },
    focusedPanelId: 'p1',
    activeView: 'dashboard',
    splitPanel: vi.fn(),
    addTab: vi.fn(),
    setView: vi.fn()
  }

  return {
    usePanelLayoutStore: vi.fn((sel?: any) => (sel ? sel(mockPanelState) : mockPanelState)),
    // getOpenViews is a standalone exported function, not a store method
    getOpenViews: vi.fn(() => ['dashboard'])
  }
})

describe('NeonSidebar', () => {
  it('shows blue badge count on Code Review when tasks are in review status', async () => {
    mockReviewCount = 2
    // pin code-review so the badge-bearing item renders
    const { useSidebarStore } = await import('../../../stores/sidebar')
    vi.mocked(useSidebarStore).mockImplementation((sel?: any) => {
      const state = {
        pinnedViews: ['dashboard', 'agents', 'code-review'],
        pinView: vi.fn(),
        unpinView: vi.fn()
      }
      return sel ? sel(state) : state
    })
    const { NeonSidebar } = await import('../NeonSidebar')
    render(<NeonSidebar />)
    const badge = screen.getByTestId('sidebar-badge-code-review')
    expect(badge).toHaveTextContent('2')
    expect(badge).toHaveAttribute('data-accent', 'blue')
    mockReviewCount = 0
  })

  it('shows red badge on Sprint Pipeline when tasks are failed/error', async () => {
    mockFailedCount = 3
    const { useSidebarStore } = await import('../../../stores/sidebar')
    vi.mocked(useSidebarStore).mockImplementation((sel?: any) => {
      const state = {
        pinnedViews: ['dashboard', 'sprint', 'ide'],
        pinView: vi.fn(),
        unpinView: vi.fn()
      }
      return sel ? sel(state) : state
    })
    const { NeonSidebar } = await import('../NeonSidebar')
    render(<NeonSidebar />)
    const badge = screen.getByTestId('sidebar-badge-sprint')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveAttribute('data-accent', 'red')
    mockFailedCount = 0
  })

  it('hides Sprint Pipeline badge when no failed tasks', async () => {
    mockFailedCount = 0
    const { useSidebarStore } = await import('../../../stores/sidebar')
    vi.mocked(useSidebarStore).mockImplementation((sel?: any) => {
      const state = {
        pinnedViews: ['dashboard', 'sprint', 'ide'],
        pinView: vi.fn(),
        unpinView: vi.fn()
      }
      return sel ? sel(state) : state
    })
    const { NeonSidebar } = await import('../NeonSidebar')
    render(<NeonSidebar />)
    expect(screen.queryByTestId('sidebar-badge-sprint')).toBeNull()
  })

  it('renders pinned view icons', async () => {
    const { NeonSidebar } = await import('../NeonSidebar')
    render(<NeonSidebar />)
    // Should render 3 pinned items + more button
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(3)
  })

  it('renders the more button', async () => {
    const { NeonSidebar } = await import('../NeonSidebar')
    render(<NeonSidebar />)
    expect(screen.getByLabelText('More views')).toBeInTheDocument()
  })

  it('renders model badge', async () => {
    const { NeonSidebar } = await import('../NeonSidebar')
    render(<NeonSidebar model="haiku" />)
    expect(screen.getByText('haiku')).toBeInTheDocument()
  })
})
