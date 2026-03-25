import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { WorkbenchCopilot } from '../WorkbenchCopilot'
import { useTaskWorkbenchStore, type CopilotMessage } from '../../../stores/taskWorkbench'

describe('WorkbenchCopilot', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useTaskWorkbenchStore.getState().resetForm()

    ;(window.api as any).workbench = {
      chat: vi.fn().mockResolvedValue({ content: 'AI response here' }),
      checkSpec: vi.fn().mockResolvedValue({}),
      checkOperational: vi.fn().mockResolvedValue({}),
      generateSpec: vi.fn().mockResolvedValue({ spec: '' }),
    }
  })

  it('renders the AI Copilot header', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.getByText('AI Copilot')).toBeInTheDocument()
  })

  it('renders close button and calls onClose', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const closeBtn = screen.getByTitle('Close copilot')
    fireEvent.click(closeBtn)
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('renders the welcome system message by default', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.getByText(/help you craft this task/)).toBeInTheDocument()
  })

  it('renders the input textarea and send button', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.getByPlaceholderText(/Ask about the codebase/)).toBeInTheDocument()
    expect(screen.getByText('Send')).toBeInTheDocument()
  })

  it('Send button is disabled when input is empty', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const sendBtn = screen.getByText('Send')
    expect(sendBtn).toBeDisabled()
  })

  it('Send button is enabled when input has text', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    expect(screen.getByText('Send')).not.toBeDisabled()
  })

  it('sends message on Send click and adds assistant reply', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'What files?' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect(screen.getByText('AI response here')).toBeInTheDocument()
    })
    expect((window.api as any).workbench.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'What files?' }),
        ]),
      }),
    )
  })

  it('clears input after sending', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByText('Send'))

    // Input should be cleared immediately
    expect(textarea.value).toBe('')
  })

  it('shows loading state while waiting for response', async () => {
    let resolveChat: (v: any) => void
    ;(window.api as any).workbench.chat = vi.fn().mockReturnValue(
      new Promise((r) => { resolveChat = r }),
    )

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Research' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect(screen.getByText('Thinking...')).toBeInTheDocument()
    })

    // Resolve the chat
    resolveChat!({ content: 'Done' })
    await waitFor(() => {
      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    })
  })

  it('shows error message when chat fails', async () => {
    ;(window.api as any).workbench.chat = vi.fn().mockRejectedValue(new Error('Network error'))

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Try this' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect(screen.getByText(/Failed to reach Claude/)).toBeInTheDocument()
    })
  })

  it('sends on Enter key (without shift)', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Enter test' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect((window.api as any).workbench.chat).toHaveBeenCalled()
    })
  })

  it('does not send on Shift+Enter', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'No send' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect((window.api as any).workbench.chat).not.toHaveBeenCalled()
  })

  it('does not send empty message', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Send'))
    expect((window.api as any).workbench.chat).not.toHaveBeenCalled()
  })

  it('does not send whitespace-only message', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Send'))
    expect((window.api as any).workbench.chat).not.toHaveBeenCalled()
  })

  it('renders multiple messages from store', () => {
    const msgs: CopilotMessage[] = [
      { id: 'sys-1', role: 'system', content: 'Welcome', timestamp: Date.now() },
      { id: 'usr-1', role: 'user', content: 'Hello bot', timestamp: Date.now() },
      { id: 'ast-1', role: 'assistant', content: 'Hi there', timestamp: Date.now(), insertable: true },
    ]
    useTaskWorkbenchStore.setState({ copilotMessages: msgs })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Hello bot')).toBeInTheDocument()
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })

  it('shows "Insert into spec" button for insertable messages', () => {
    const msgs: CopilotMessage[] = [
      { id: 'ast-1', role: 'assistant', content: 'Spec content', timestamp: Date.now(), insertable: true },
    ]
    useTaskWorkbenchStore.setState({ copilotMessages: msgs })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.getByText('Insert into spec')).toBeInTheDocument()
  })

  it('does not show "Insert into spec" for non-insertable messages', () => {
    const msgs: CopilotMessage[] = [
      { id: 'usr-1', role: 'user', content: 'My question', timestamp: Date.now() },
    ]
    useTaskWorkbenchStore.setState({ copilotMessages: msgs })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.queryByText('Insert into spec')).not.toBeInTheDocument()
  })

  it('clicking "Insert into spec" appends to spec field', () => {
    useTaskWorkbenchStore.setState({
      spec: 'Existing spec',
      copilotMessages: [
        { id: 'ast-1', role: 'assistant', content: 'New content', timestamp: Date.now(), insertable: true },
      ],
    })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Insert into spec'))

    expect(useTaskWorkbenchStore.getState().spec).toBe('Existing spec\n\nNew content')
  })

  it('inserting into empty spec does not prepend separator', () => {
    useTaskWorkbenchStore.setState({
      spec: '',
      copilotMessages: [
        { id: 'ast-1', role: 'assistant', content: 'First content', timestamp: Date.now(), insertable: true },
      ],
    })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Insert into spec'))

    expect(useTaskWorkbenchStore.getState().spec).toBe('First content')
  })

  it('filters system messages from chat API call', async () => {
    useTaskWorkbenchStore.setState({
      copilotMessages: [
        { id: 'sys-1', role: 'system', content: 'Welcome', timestamp: Date.now() },
      ],
    })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Question' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      const call = (window.api as any).workbench.chat.mock.calls[0][0]
      // System messages should be filtered out
      const systemMsgs = call.messages.filter((m: any) => m.role === 'system')
      expect(systemMsgs).toHaveLength(0)
    })
  })
})
