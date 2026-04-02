// src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  useReducedMotion: () => false
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
