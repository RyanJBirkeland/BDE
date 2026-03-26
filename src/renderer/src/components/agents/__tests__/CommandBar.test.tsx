import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../CommandBar'

describe('CommandBar', () => {
  const defaultProps = {
    onSend: vi.fn(),
    onCommand: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders prompt character', () => {
    const { container } = render(<CommandBar {...defaultProps} />)
    const prompt = container.querySelector('.command-bar__prompt')
    expect(prompt).toBeInTheDocument()
    expect(prompt).toHaveTextContent('>')
  })

  it('renders input field with placeholder', () => {
    render(<CommandBar {...defaultProps} />)
    expect(screen.getByPlaceholderText('Type a message or / for commands...')).toBeInTheDocument()
  })

  it('shows autocomplete when typing /', async () => {
    const user = userEvent.setup()
    const { container } = render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, '/')

    await waitFor(() => {
      expect(container.querySelector('.command-autocomplete')).toBeInTheDocument()
    })
  })

  it('shows filtered commands in autocomplete', async () => {
    const user = userEvent.setup()
    render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, '/sto')

    await waitFor(() => {
      expect(screen.getByText('/stop')).toBeInTheDocument()
    })
  })

  it('hides autocomplete when input does not start with /', async () => {
    const user = userEvent.setup()
    const { container } = render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, 'hello')

    expect(container.querySelector('.command-autocomplete')).not.toBeInTheDocument()
  })

  it('sends free text message on Enter', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<CommandBar {...defaultProps} onSend={onSend} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, 'hello world')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith('hello world')
    expect(input).toHaveValue('')
  })

  it('sends slash command with onCommand on Enter', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<CommandBar {...defaultProps} onCommand={onCommand} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, '/stop')
    // Wait for autocomplete to appear, then press Escape to close it
    await waitFor(() => {
      expect(screen.getByText('/stop')).toBeInTheDocument()
    })
    await user.keyboard('{Escape}')
    await user.keyboard('{Enter}')

    expect(onCommand).toHaveBeenCalledWith('/stop', undefined)
    expect(input).toHaveValue('')
  })

  it('sends slash command with arguments', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<CommandBar {...defaultProps} onCommand={onCommand} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, '/focus authentication')
    // Close autocomplete
    await user.keyboard('{Escape}')
    await user.keyboard('{Enter}')

    expect(onCommand).toHaveBeenCalledWith('/focus', 'authentication')
    expect(input).toHaveValue('')
  })

  it('does not send on empty input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onCommand = vi.fn()
    render(<CommandBar {...defaultProps} onSend={onSend} onCommand={onCommand} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('disabled state disables input', () => {
    render(<CommandBar {...defaultProps} disabled={true} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')
    expect(input).toBeDisabled()
  })

  it('disabled state shows disabledReason as placeholder', () => {
    render(<CommandBar {...defaultProps} disabled={true} disabledReason="Agent is not running" />)
    expect(screen.getByPlaceholderText('Agent is not running')).toBeInTheDocument()
  })

  it('does not send when disabled', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onCommand = vi.fn()
    render(<CommandBar {...defaultProps} onSend={onSend} onCommand={onCommand} disabled={true} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    // Try to type and send (should not work due to disabled state)
    await user.type(input, 'test')
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('clears input after sending', async () => {
    const user = userEvent.setup()
    render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, 'test message')
    await user.keyboard('{Enter}')

    expect(input).toHaveValue('')
  })

  it('autocomplete selects command on click', async () => {
    const user = userEvent.setup()
    render(<CommandBar {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a message or / for commands...')

    await user.type(input, '/')

    await waitFor(() => {
      expect(screen.getByText('/stop')).toBeInTheDocument()
    })

    await user.click(screen.getByText('/stop'))

    expect(input).toHaveValue('/stop ')
  })
})
