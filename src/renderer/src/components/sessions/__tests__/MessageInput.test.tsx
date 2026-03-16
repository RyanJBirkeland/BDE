import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageInput } from '../MessageInput'

const mockCall = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../stores/gateway', () => ({
  useGatewayStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ client: { call: mockCall } })
  ),
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('MessageInput', () => {
  const defaultProps = {
    sessionKey: 'test-session',
    onSent: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCall.mockResolvedValue(undefined)
  })

  it('renders textarea and Send button', () => {
    render(<MessageInput {...defaultProps} />)
    expect(screen.getByPlaceholderText('Message...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('typing in textarea updates value', async () => {
    const user = userEvent.setup()
    render(<MessageInput {...defaultProps} />)
    const textarea = screen.getByPlaceholderText('Message...')
    await user.type(textarea, 'Hello')
    expect(textarea).toHaveValue('Hello')
  })

  it('Send button is disabled when input is empty', () => {
    render(<MessageInput {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('Send button is disabled when disabled prop is true', async () => {
    const user = userEvent.setup()
    render(<MessageInput {...defaultProps} disabled />)
    const textarea = screen.getByPlaceholderText('Message...')
    await user.type(textarea, 'Hello')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('Enter key calls send', async () => {
    const user = userEvent.setup()
    render(<MessageInput {...defaultProps} />)
    const textarea = screen.getByPlaceholderText('Message...')
    await user.type(textarea, 'Hello')
    await user.keyboard('{Enter}')
    expect(mockCall).toHaveBeenCalledWith('chat.send', {
      sessionKey: 'test-session',
      text: 'Hello',
    })
  })

  it('Shift+Enter does NOT submit', async () => {
    const user = userEvent.setup()
    render(<MessageInput {...defaultProps} />)
    const textarea = screen.getByPlaceholderText('Message...')
    await user.type(textarea, 'Hello')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('calls onSent callback after successful send', async () => {
    const user = userEvent.setup()
    render(<MessageInput {...defaultProps} />)
    const textarea = screen.getByPlaceholderText('Message...')
    await user.type(textarea, 'Test message')
    await user.keyboard('{Enter}')
    expect(defaultProps.onSent).toHaveBeenCalled()
  })

  it('clears text after send', async () => {
    const user = userEvent.setup()
    render(<MessageInput {...defaultProps} />)
    const textarea = screen.getByPlaceholderText('Message...')
    await user.type(textarea, 'Test')
    await user.keyboard('{Enter}')
    // Text should be cleared immediately (optimistic)
    expect(textarea).toHaveValue('')
  })

  it('calls onBeforeSend callback before sending', async () => {
    const onBeforeSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput {...defaultProps} onBeforeSend={onBeforeSend} />)
    const textarea = screen.getByPlaceholderText('Message...')
    await user.type(textarea, 'msg')
    await user.keyboard('{Enter}')
    expect(onBeforeSend).toHaveBeenCalledWith('msg')
  })
})
