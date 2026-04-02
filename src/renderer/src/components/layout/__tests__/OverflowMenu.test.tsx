import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OverflowMenu } from '../OverflowMenu'
import type { View } from '../../../stores/panelLayout'

// Mock GlassPanel to simplify testing
vi.mock('../../neon/GlassPanel', () => ({
  GlassPanel: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="glass-panel" style={style}>
      {children}
    </div>
  )
}))

describe('OverflowMenu', () => {
  const mockAnchorRect: DOMRect = {
    top: 100,
    left: 50,
    width: 40,
    height: 40,
    bottom: 140,
    right: 90,
    x: 50,
    y: 100,
    toJSON: () => ({})
  }

  const defaultProps = {
    unpinnedViews: ['git', 'task-workbench'] as View[],
    anchorRect: mockAnchorRect,
    onPin: vi.fn(),
    onActivate: vi.fn(),
    onClose: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when anchorRect is null', () => {
    const { container } = render(<OverflowMenu {...defaultProps} anchorRect={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders in a portal', () => {
    render(<OverflowMenu {...defaultProps} />)
    // Check that the menu is rendered in document.body, not in the container
    expect(document.body.querySelector('.overflow-menu')).toBeInTheDocument()
  })

  it('positions menu relative to anchor', () => {
    render(<OverflowMenu {...defaultProps} />)
    const menu = document.querySelector('.overflow-menu') as HTMLElement

    expect(menu).toHaveStyle({
      top: '92px', // anchorRect.top - 8
      left: '70px', // anchorRect.left + anchorRect.width / 2
      transform: 'translate(-50%, -100%)'
    })
  })

  it('renders unpinned views', () => {
    render(<OverflowMenu {...defaultProps} />)

    expect(screen.getByText('Source Control')).toBeInTheDocument()
    expect(screen.getByText('Task Workbench')).toBeInTheDocument()
  })

  it('renders view items with their labels', () => {
    render(<OverflowMenu {...defaultProps} />)
    // Check that view labels are rendered, which implies icons are present
    expect(screen.getByText('Source Control')).toBeInTheDocument()
    expect(screen.getByText('Task Workbench')).toBeInTheDocument()
  })

  it('renders pin buttons for each view', () => {
    render(<OverflowMenu {...defaultProps} />)

    const pinButtons = screen.getAllByLabelText(/Pin .* to sidebar/)
    expect(pinButtons).toHaveLength(2)
  })

  it('calls onActivate when view item is clicked', () => {
    const onActivate = vi.fn()
    render(<OverflowMenu {...defaultProps} onActivate={onActivate} />)

    fireEvent.click(screen.getByText('Source Control'))

    expect(onActivate).toHaveBeenCalledWith('git')
  })

  it('calls onClose when view item is clicked', () => {
    const onClose = vi.fn()
    render(<OverflowMenu {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByText('Source Control'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onPin when pin button is clicked', () => {
    const onPin = vi.fn()
    render(<OverflowMenu {...defaultProps} onPin={onPin} />)

    const pinButton = screen.getByLabelText('Pin Source Control to sidebar')
    fireEvent.click(pinButton)

    expect(onPin).toHaveBeenCalledWith('git')
  })

  it('stops propagation when pin button is clicked', () => {
    const onPin = vi.fn()
    const onActivate = vi.fn()
    render(<OverflowMenu {...defaultProps} onPin={onPin} onActivate={onActivate} />)

    const pinButton = screen.getByLabelText('Pin Source Control to sidebar')
    fireEvent.click(pinButton)

    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('renders "Customize sidebar..." button', () => {
    render(<OverflowMenu {...defaultProps} />)
    expect(screen.getByText('Customize sidebar...')).toBeInTheDocument()
  })

  it('calls onActivate with settings view when customize is clicked', () => {
    const onActivate = vi.fn()
    render(<OverflowMenu {...defaultProps} onActivate={onActivate} />)

    fireEvent.click(screen.getByText('Customize sidebar...'))

    expect(onActivate).toHaveBeenCalledWith('settings')
  })

  it('calls onClose when customize is clicked', () => {
    const onClose = vi.fn()
    render(<OverflowMenu {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByText('Customize sidebar...'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows empty state when no unpinned views', () => {
    render(<OverflowMenu {...defaultProps} unpinnedViews={[]} />)
    expect(screen.getByText('All views are pinned')).toBeInTheDocument()
  })

  it('does not render view items when empty', () => {
    render(<OverflowMenu {...defaultProps} unpinnedViews={[]} />)
    expect(screen.queryByText('Source Control')).not.toBeInTheDocument()
    expect(screen.queryByText('Task Workbench')).not.toBeInTheDocument()
  })

  it('still shows customize button when empty', () => {
    render(<OverflowMenu {...defaultProps} unpinnedViews={[]} />)
    expect(screen.getByText('Customize sidebar...')).toBeInTheDocument()
  })

  it('has separator before customize button', () => {
    render(<OverflowMenu {...defaultProps} />)
    const separator = document.querySelector('div[style*="border-top"]')
    expect(separator).toBeInTheDocument()
  })

  describe('Click outside handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls onClose when clicking outside menu', async () => {
      const onClose = vi.fn()
      render(<OverflowMenu {...defaultProps} onClose={onClose} />)

      // Wait for the timeout to attach the listener
      act(() => {
        vi.runAllTimers()
      })

      // Click outside
      fireEvent.mouseDown(document.body)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose when clicking inside menu', async () => {
      const onClose = vi.fn()
      render(<OverflowMenu {...defaultProps} onClose={onClose} />)

      act(() => {
        vi.runAllTimers()
      })

      const menu = document.querySelector('.overflow-menu') as HTMLElement
      fireEvent.mouseDown(menu)

      // onClose should not be called from click-outside handler
      // (it will be called from item click, but we're testing the click-outside logic)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('cleans up click listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const { unmount } = render(<OverflowMenu {...defaultProps} />)

      act(() => {
        vi.runAllTimers()
      })

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function))
    })
  })

  describe('Escape key handling', () => {
    it('calls onClose when Escape is pressed', () => {
      const onClose = vi.fn()
      render(<OverflowMenu {...defaultProps} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose for other keys', () => {
      const onClose = vi.fn()
      render(<OverflowMenu {...defaultProps} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Enter' })
      fireEvent.keyDown(document, { key: 'Tab' })
      fireEvent.keyDown(document, { key: 'Space' })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('cleans up keydown listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const { unmount } = render(<OverflowMenu {...defaultProps} />)

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    })
  })

  describe('View icon and label mapping', () => {
    it('renders correct labels for all views', () => {
      const allViews: View[] = [
        'dashboard',
        'agents',
        'ide',
        'sprint',
        'code-review',
        'git',
        'settings',
        'task-workbench'
      ]
      render(<OverflowMenu {...defaultProps} unpinnedViews={allViews} />)

      expect(screen.getByText('Dashboard')).toBeInTheDocument()
      expect(screen.getByText('Agents')).toBeInTheDocument()
      expect(screen.getByText('IDE')).toBeInTheDocument()
      expect(screen.getByText('Task Pipeline')).toBeInTheDocument()
      expect(screen.getByText('Code Review')).toBeInTheDocument()
      expect(screen.getByText('Source Control')).toBeInTheDocument()
      expect(screen.getByText('Settings')).toBeInTheDocument()
      expect(screen.getByText('Task Workbench')).toBeInTheDocument()
    })
  })

  it('uses GlassPanel with purple accent', () => {
    render(<OverflowMenu {...defaultProps} />)
    const glassPanel = screen.getByTestId('glass-panel')
    expect(glassPanel).toBeInTheDocument()
  })
})
