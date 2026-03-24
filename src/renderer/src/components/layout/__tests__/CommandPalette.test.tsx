import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from '../CommandPalette'

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: { setView: () => void }) => unknown) =>
    selector({ setView: vi.fn() })
  ),
}))

vi.mock('../../../stores/localAgents', () => ({
  useLocalAgentsStore: Object.assign(
    vi.fn((selector: (s: { processes: [] }) => unknown) =>
      selector({ processes: [] })
    ),
    {
      getState: () => ({
        processes: [],
        killLocalAgent: vi.fn().mockResolvedValue(undefined),
      }),
    }
  ),
}))

vi.mock('../../../stores/agentHistory', () => ({
  useAgentHistoryStore: Object.assign(
    vi.fn((selector: (s: { selectAgent: () => void }) => unknown) =>
      selector({ selectAgent: vi.fn() })
    ),
    {
      getState: () => ({
        agents: [],
        fetchAgents: vi.fn().mockResolvedValue(undefined),
      }),
    }
  ),
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

describe('CommandPalette', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when not open', () => {
    const { container } = render(<CommandPalette open={false} onClose={onClose} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders input when open', () => {
    render(<CommandPalette open={true} onClose={onClose} />)
    expect(screen.getByPlaceholderText(/Type a command/)).toBeInTheDocument()
  })

  it('shows navigation group', () => {
    render(<CommandPalette open={true} onClose={onClose} />)
    expect(screen.getByText('Navigate')).toBeInTheDocument()
  })

  it('shows actions group', () => {
    render(<CommandPalette open={true} onClose={onClose} />)
    expect(screen.getByText('Agent Actions')).toBeInTheDocument()
  })

  it('filters commands by search input', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.type(input, 'agents')

    expect(screen.getByText('Go to Agents')).toBeInTheDocument()
    expect(screen.queryByText('Go to Cost')).not.toBeInTheDocument()
  })

  it('shows no matching commands for bad query', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.type(input, 'zzzzzzz')

    expect(screen.getByText('No matching commands')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on overlay click', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const overlay = document.querySelector('.command-palette__overlay')!
    await user.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it('ArrowDown moves selection to next item', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.click(input)
    await user.keyboard('{ArrowDown}')

    // Second item should now have selected class
    const selected = document.querySelectorAll('.command-palette__item--selected')
    expect(selected.length).toBe(1)
    // The selected item should not be the first one anymore
    const items = document.querySelectorAll('.command-palette__item')
    expect(items[1]).toHaveClass('command-palette__item--selected')
  })

  it('ArrowUp does not go below 0', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.click(input)
    // ArrowUp from 0 stays at 0
    await user.keyboard('{ArrowUp}')

    const items = document.querySelectorAll('.command-palette__item')
    expect(items[0]).toHaveClass('command-palette__item--selected')
  })

  it('Enter key runs selected command and closes', async () => {
    const user = userEvent.setup()
    const mockSetView = vi.fn()
    const { useUIStore } = await import('../../../stores/ui')
    vi.mocked(useUIStore).mockImplementation((selector) =>
      selector({ setView: mockSetView, activeView: 'agents' } as any)
    )

    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.click(input)
    await user.keyboard('{Enter}')

    // The first command should have been executed — setView called or onClose called
    expect(onClose).toHaveBeenCalled()
  })

  it('typing resets selected index to 0', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.click(input)
    await user.keyboard('{ArrowDown}{ArrowDown}')

    // Now type to reset
    await user.type(input, 'agents')

    const items = document.querySelectorAll('.command-palette__item')
    if (items.length > 0) {
      expect(items[0]).toHaveClass('command-palette__item--selected')
    }
  })

  it('hovering an item changes selection', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const items = document.querySelectorAll('.command-palette__item')
    expect(items.length).toBeGreaterThan(1)

    await user.hover(items[2])
    expect(items[2]).toHaveClass('command-palette__item--selected')
  })

  it('clicking a command calls onClose', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const items = document.querySelectorAll('.command-palette__item')
    await user.click(items[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('shows "Panels" group header', () => {
    render(<CommandPalette open={true} onClose={onClose} />)
    expect(screen.getByText('Panels')).toBeInTheDocument()
  })

  it('shows Spawn Agent command', () => {
    render(<CommandPalette open={true} onClose={onClose} />)
    expect(screen.getByText('Spawn Agent')).toBeInTheDocument()
  })

  it('filters down to panel commands when typing "split"', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.type(input, 'split')

    expect(screen.getByText('Split Right')).toBeInTheDocument()
    expect(screen.queryByText('Go to Agents')).not.toBeInTheDocument()
  })

  it('fuzzy match works for abbreviated queries', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.type(input, 'gta') // matches "Go to Agents"

    expect(screen.getByText('Go to Agents')).toBeInTheDocument()
  })
})
