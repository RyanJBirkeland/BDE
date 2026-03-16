import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ChatThread } from '../ChatThread'

const mockInvokeTool = vi.fn()

vi.mock('../../../lib/rpc', () => ({
  invokeTool: (...args: unknown[]) => mockInvokeTool(...args),
}))

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: { activeView: string }) => unknown) =>
    selector({ activeView: 'sessions' })
  ),
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('ChatThread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvokeTool.mockResolvedValue({ messages: [] })
  })

  it('renders user and assistant messages', async () => {
    mockInvokeTool.mockResolvedValue({
      messages: [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi! How can I help?' },
      ],
    })

    render(<ChatThread sessionKey="test-session" />)

    await waitFor(() => {
      expect(screen.getByText('Hello there')).toBeInTheDocument()
    })
    expect(screen.getByText(/How can I help/)).toBeInTheDocument()
  })

  it('renders tool messages as collapsible cards', async () => {
    mockInvokeTool.mockResolvedValue({
      messages: [
        { role: 'tool', content: 'file contents here', toolName: 'Read' },
      ],
    })

    render(<ChatThread sessionKey="test-session" />)

    await waitFor(() => {
      expect(screen.getByText('Read')).toBeInTheDocument()
    })
    // Tool content preview should be visible
    expect(screen.getByText('file contents here')).toBeInTheDocument()
  })

  it('renders optimistic messages with correct role styling', async () => {
    mockInvokeTool.mockResolvedValue({ messages: [] })

    const optimistic = [
      { role: 'user' as const, content: 'Pending message' },
    ]

    render(<ChatThread sessionKey="test-session" optimisticMessages={optimistic} />)

    await waitFor(() => {
      expect(screen.getByText('Pending message')).toBeInTheDocument()
    })

    const msgEl = screen.getByText('Pending message').closest('.chat-msg')
    expect(msgEl).toHaveClass('chat-msg--user')
  })

  it('shows empty state when no messages', async () => {
    mockInvokeTool.mockResolvedValue({ messages: [] })

    render(<ChatThread sessionKey="test-session" />)

    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeInTheDocument()
    })
  })

  it('shows loading spinner initially', () => {
    // Don't resolve the mock so loading stays true
    mockInvokeTool.mockReturnValue(new Promise(() => {}))

    render(<ChatThread sessionKey="test-session" />)

    // The loading state renders a spinner container
    const loadingEl = document.querySelector('.chat-thread--loading')
    expect(loadingEl).toBeInTheDocument()
  })

  it('renders system messages with system class', async () => {
    mockInvokeTool.mockResolvedValue({
      messages: [
        { role: 'system', content: 'System notification' },
      ],
    })

    render(<ChatThread sessionKey="test-session" />)

    await waitFor(() => {
      expect(screen.getByText('System notification')).toBeInTheDocument()
    })

    const msgEl = screen.getByText('System notification').closest('.chat-msg')
    expect(msgEl).toHaveClass('chat-msg--system')
  })
})
