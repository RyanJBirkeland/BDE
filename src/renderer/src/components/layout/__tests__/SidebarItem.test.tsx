import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SidebarItem } from '../SidebarItem'
import type { View } from '../../../stores/panelLayout'

// Mock NeonTooltip to simplify testing
vi.mock('../../neon/NeonTooltip', () => ({
  NeonTooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

describe('SidebarItem', () => {
  const defaultProps = {
    view: 'dashboard' as View,
    icon: <span data-testid="test-icon">📊</span>,
    label: 'Dashboard',
    shortcut: '⌘1',
    isActive: false,
    isOpen: false,
    onActivate: vi.fn(),
    onContextAction: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the icon', () => {
    render(<SidebarItem {...defaultProps} />)
    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
  })

  it('applies active class when isActive is true', () => {
    const { container } = render(<SidebarItem {...defaultProps} isActive={true} />)
    const button = container.querySelector('.sidebar-item--active')
    expect(button).toBeInTheDocument()
  })

  it('does not apply active class when isActive is false', () => {
    const { container } = render(<SidebarItem {...defaultProps} isActive={false} />)
    expect(container.querySelector('.sidebar-item--active')).not.toBeInTheDocument()
  })

  it('calls onActivate when clicked', () => {
    const onActivate = vi.fn()
    render(<SidebarItem {...defaultProps} onActivate={onActivate} />)
    fireEvent.click(screen.getByLabelText('Dashboard'))
    expect(onActivate).toHaveBeenCalledWith('dashboard')
  })

  it('stops propagation when clicked', () => {
    const onActivate = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <SidebarItem {...defaultProps} onActivate={onActivate} />
      </div>
    )
    fireEvent.click(screen.getByLabelText('Dashboard'))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('has correct ARIA attributes', () => {
    render(<SidebarItem {...defaultProps} />)
    const button = screen.getByLabelText('Dashboard')
    expect(button).toHaveAttribute('aria-label', 'Dashboard')
    expect(button).not.toHaveAttribute('aria-current')
  })

  it('has aria-current when active', () => {
    render(<SidebarItem {...defaultProps} isActive={true} />)
    const button = screen.getByLabelText('Dashboard')
    expect(button).toHaveAttribute('aria-current', 'page')
  })

  it('does not show open dot when not open', () => {
    const { container } = render(<SidebarItem {...defaultProps} isOpen={false} />)
    expect(container.querySelector('.sidebar-item__open-dot')).not.toBeInTheDocument()
  })

  it('shows open dot when open and not active', () => {
    const { container } = render(<SidebarItem {...defaultProps} isOpen={true} isActive={false} />)
    expect(container.querySelector('.sidebar-item__open-dot')).toBeInTheDocument()
  })

  it('hides open dot when open and active', () => {
    const { container } = render(<SidebarItem {...defaultProps} isOpen={true} isActive={true} />)
    expect(container.querySelector('.sidebar-item__open-dot')).not.toBeInTheDocument()
  })

  it('is draggable', () => {
    render(<SidebarItem {...defaultProps} />)
    const button = screen.getByLabelText('Dashboard')
    expect(button).toHaveAttribute('draggable', 'true')
  })

  it('sets drag data on drag start', () => {
    render(<SidebarItem {...defaultProps} />)
    const button = screen.getByLabelText('Dashboard')

    const mockDataTransfer = {
      effectAllowed: '',
      setData: vi.fn()
    }

    fireEvent.dragStart(button, {
      dataTransfer: mockDataTransfer
    })

    expect(mockDataTransfer.effectAllowed).toBe('move')
    expect(mockDataTransfer.setData).toHaveBeenCalledWith(
      'application/bde-panel',
      JSON.stringify({ viewKey: 'dashboard' })
    )
    expect(mockDataTransfer.setData).toHaveBeenCalledWith('text/plain', 'Dashboard')
  })

  describe('Context Menu', () => {
    it('does not show context menu initially', () => {
      render(<SidebarItem {...defaultProps} />)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('shows context menu on right click', () => {
      render(<SidebarItem {...defaultProps} />)
      const button = screen.getByLabelText('Dashboard')
      fireEvent.contextMenu(button)
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('positions context menu at click location', () => {
      render(<SidebarItem {...defaultProps} />)
      const button = screen.getByLabelText('Dashboard')

      fireEvent.contextMenu(button, { clientX: 100, clientY: 200 })

      const menu = screen.getByRole('menu')
      expect(menu).toHaveStyle({ top: '200px', left: '100px' })
    })

    it('renders all context menu items', () => {
      render(<SidebarItem {...defaultProps} />)
      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))

      expect(screen.getByText('Unpin from sidebar')).toBeInTheDocument()
      expect(screen.getByText('Open to Right')).toBeInTheDocument()
      expect(screen.getByText('Open Below')).toBeInTheDocument()
      expect(screen.getByText('Open in New Tab')).toBeInTheDocument()
      expect(screen.getByText('Close All')).toBeInTheDocument()
    })

    it('calls onContextAction with correct action when menu item is clicked', () => {
      const onContextAction = vi.fn()
      render(<SidebarItem {...defaultProps} onContextAction={onContextAction} />)

      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))
      fireEvent.click(screen.getByText('Unpin from sidebar'))

      expect(onContextAction).toHaveBeenCalledWith('unpin', 'dashboard')
    })

    it('closes context menu after menu item is clicked', () => {
      render(<SidebarItem {...defaultProps} />)

      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Open to Right'))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes context menu on outside click', () => {
      render(<SidebarItem {...defaultProps} />)

      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      // Click the overlay (first child before the menu)
      const overlay = document.querySelector('div[style*="position: fixed"][style*="inset: 0"]')
      expect(overlay).toBeInTheDocument()
      fireEvent.click(overlay!)

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes context menu on right click outside', () => {
      render(<SidebarItem {...defaultProps} />)

      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      const overlay = document.querySelector('div[style*="position: fixed"][style*="inset: 0"]')
      fireEvent.contextMenu(overlay!)

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('stops propagation when opening context menu', () => {
      const parentContextMenu = vi.fn()
      render(
        <div onContextMenu={parentContextMenu}>
          <SidebarItem {...defaultProps} />
        </div>
      )

      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))
      expect(parentContextMenu).not.toHaveBeenCalled()
    })

    it('stops propagation when clicking menu item', () => {
      const parentClick = vi.fn()
      render(
        <div onClick={parentClick}>
          <SidebarItem {...defaultProps} />
        </div>
      )

      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))
      fireEvent.click(screen.getByText('Close All'))

      expect(parentClick).not.toHaveBeenCalled()
    })

    it('renders overlay with correct z-index', () => {
      render(<SidebarItem {...defaultProps} />)
      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))

      const overlay = document.querySelector('div[style*="z-index: 999"]')
      expect(overlay).toBeInTheDocument()
    })

    it('renders menu with CSS class', () => {
      render(<SidebarItem {...defaultProps} />)
      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))

      const menu = screen.getByRole('menu')
      expect(menu).toHaveClass('sidebar-context-menu')
    })

    it('applies CSS classes to menu items', () => {
      render(<SidebarItem {...defaultProps} />)
      fireEvent.contextMenu(screen.getByLabelText('Dashboard'))

      const menuItem = screen.getByText('Open to Right')
      expect(menuItem).toHaveClass('sidebar-context-menu__item')
    })
  })
})
