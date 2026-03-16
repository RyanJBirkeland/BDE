import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from '../CommandPalette'

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: { setView: () => void }) => unknown) =>
    selector({ setView: vi.fn() })
  ),
}))

vi.mock('../../../stores/gateway', () => ({
  useGatewayStore: vi.fn((selector: (s: { connect: () => void }) => unknown) =>
    selector({ connect: vi.fn() })
  ),
}))

vi.mock('../../../stores/sessions', () => ({
  useSessionsStore: Object.assign(
    vi.fn((selector: (s: { selectSession: () => void }) => unknown) =>
      selector({ selectSession: vi.fn() })
    ),
    {
      getState: () => ({
        sessions: [],
        fetchSessions: vi.fn().mockResolvedValue(undefined),
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
    expect(screen.getByText('Navigation')).toBeInTheDocument()
  })

  it('shows actions group', () => {
    render(<CommandPalette open={true} onClose={onClose} />)
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })

  it('filters commands by search input', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Type a command/)
    await user.type(input, 'sessions')

    expect(screen.getByText('Go to Sessions')).toBeInTheDocument()
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
})
