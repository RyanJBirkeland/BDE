// src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  useReducedMotion: () => false
}))

let mockReviewCount = 0

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel?: any) => {
    const state = {
      tasks: Array.from({ length: mockReviewCount }, (_, i) => ({
        id: String(i),
        status: 'review',
        title: `Task ${i}`
      }))
    }
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
  it('shows badge count on Code Review when tasks are in review status', async () => {
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
    expect(screen.getByTestId('sidebar-badge-code-review')).toHaveTextContent('2')
    mockReviewCount = 0
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
