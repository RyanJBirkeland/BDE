import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SteerInput } from '../SteerInput'

describe('SteerInput', () => {
  const defaultProps = {
    agentId: 'agent-1',
    onSend: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders textarea with placeholder', () => {
    render(<SteerInput {...defaultProps} />)
    expect(screen.getByPlaceholderText('Steer this agent...')).toBeInTheDocument()
  })

  it('renders send button', () => {
    render(<SteerInput {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
  })

  it('send button is disabled when input is empty', () => {
    render(<SteerInput {...defaultProps} />)
    const button = screen.getByRole('button', { name: 'Send message' })
    expect(button).toBeDisabled()
  })

  it('send button is disabled when input is only whitespace', async () => {
    const user = userEvent.setup()
    render(<SteerInput {...defaultProps} />)
    await user.type(screen.getByPlaceholderText('Steer this agent...'), '   ')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('send button is enabled when input has text', async () => {
    const user = userEvent.setup()
    render(<SteerInput {...defaultProps} />)
    await user.type(screen.getByPlaceholderText('Steer this agent...'), 'hello')
    expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled()
  })

  it('calls onSend with trimmed text when send button is clicked', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<SteerInput agentId="a1" onSend={onSend} />)
    await user.type(screen.getByPlaceholderText('Steer this agent...'), '  hello world  ')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith('hello world')
  })

  it('clears textarea after sending', async () => {
    const user = userEvent.setup()
    render(<SteerInput {...defaultProps} />)
    const textarea = screen.getByPlaceholderText('Steer this agent...')
    await user.type(textarea, 'test message')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(textarea).toHaveValue('')
  })

  it('sends on Enter key press', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<SteerInput agentId="a1" onSend={onSend} />)
    const textarea = screen.getByPlaceholderText('Steer this agent...')
    await user.type(textarea, 'enter test')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('enter test')
    expect(textarea).toHaveValue('')
  })

  it('does not send on Shift+Enter (allows newline)', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<SteerInput agentId="a1" onSend={onSend} />)
    const textarea = screen.getByPlaceholderText('Steer this agent...')
    await user.type(textarea, 'line one')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not call onSend when Enter is pressed on empty input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<SteerInput agentId="a1" onSend={onSend} />)
    await user.click(screen.getByPlaceholderText('Steer this agent...'))
    await user.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not call onSend when button clicked on empty input', async () => {
    const onSend = vi.fn()
    render(<SteerInput agentId="a1" onSend={onSend} />)
    // Button is disabled, but let's verify onSend is not called
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sets data-agent-id attribute on container', () => {
    const { container } = render(<SteerInput agentId="agent-42" onSend={vi.fn()} />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.getAttribute('data-agent-id')).toBe('agent-42')
  })

  it('textarea has rows=1 by default', () => {
    render(<SteerInput {...defaultProps} />)
    const textarea = screen.getByPlaceholderText('Steer this agent...')
    expect(textarea.getAttribute('rows')).toBe('1')
  })
})
