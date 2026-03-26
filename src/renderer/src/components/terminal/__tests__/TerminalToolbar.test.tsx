import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalToolbar } from '../TerminalToolbar'

const defaultProps = {
  isAgentTab: false,
  splitEnabled: false,
  onClear: vi.fn(),
  onToggleSplit: vi.fn()
}

describe('TerminalToolbar', () => {
  it('renders the clear button for non-agent tab', () => {
    render(<TerminalToolbar {...defaultProps} />)
    // The clear button shows the ⌘K keyboard shortcut
    expect(screen.getByTitle('Clear terminal')).toBeInTheDocument()
  })

  it('renders the split button', () => {
    render(<TerminalToolbar {...defaultProps} />)
    expect(screen.getByTitle('Split pane (⌘⇧D)')).toBeInTheDocument()
  })

  it('hides the clear button for agent tabs', () => {
    render(<TerminalToolbar {...defaultProps} isAgentTab={true} />)
    expect(screen.queryByTitle('Clear terminal')).not.toBeInTheDocument()
  })

  it('still renders split button for agent tabs', () => {
    render(<TerminalToolbar {...defaultProps} isAgentTab={true} />)
    expect(screen.getByTitle('Split pane (⌘⇧D)')).toBeInTheDocument()
  })

  it('calls onClear when clear button is clicked', async () => {
    const onClear = vi.fn()
    const user = userEvent.setup()
    render(<TerminalToolbar {...defaultProps} onClear={onClear} />)
    await user.click(screen.getByTitle('Clear terminal'))
    expect(onClear).toHaveBeenCalled()
  })

  it('calls onToggleSplit when split button is clicked', async () => {
    const onToggleSplit = vi.fn()
    const user = userEvent.setup()
    render(<TerminalToolbar {...defaultProps} onToggleSplit={onToggleSplit} />)
    await user.click(screen.getByTitle('Split pane (⌘⇧D)'))
    expect(onToggleSplit).toHaveBeenCalled()
  })

  it('shows "Close split" title when splitEnabled is true', () => {
    render(<TerminalToolbar {...defaultProps} splitEnabled={true} />)
    expect(screen.getByTitle('Close split (⌘⇧D)')).toBeInTheDocument()
  })
})
