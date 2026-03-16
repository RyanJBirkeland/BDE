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

  it('renders optimistic messages with visible content', async () => {
    mockInvokeTool.mockResolvedValue({ messages: [] })

    const optimistic = [
      { role: 'user' as const, content: 'Pending message' },
    ]

    render(<ChatThread sessionKey="test-session" optimisticMessages={optimistic} />)

    await waitFor(() => {
      expect(screen.getByText('Pending message')).toBeInTheDocument()
    })
  })

  it('shows empty state when no messages', async () => {
    mockInvokeTool.mockResolvedValue({ messages: [] })

    render(<ChatThread sessionKey="test-session" />)

    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    // Don't resolve the mock so loading stays true
    mockInvokeTool.mockReturnValue(new Promise(() => {}))

    const { container } = render(<ChatThread sessionKey="test-session" />)

    // Should not show "No messages yet" while loading
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument()
    // Container should have rendered content
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders system messages', async () => {
    mockInvokeTool.mockResolvedValue({
      messages: [
        { role: 'system', content: 'System notification' },
      ],
    })

    render(<ChatThread sessionKey="test-session" />)

    await waitFor(() => {
      expect(screen.getByText('System notification')).toBeInTheDocument()
    })
  })
})
