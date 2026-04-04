import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { WorkbenchCopilot, isResearchQuery, extractSearchTerms } from '../WorkbenchCopilot'
import { useTaskWorkbenchStore, type CopilotMessage } from '../../../stores/taskWorkbench'

describe('WorkbenchCopilot', () => {
  const mockOnClose = vi.fn()
  let chunkCallback: ((data: any) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    chunkCallback = null
    useTaskWorkbenchStore.getState().resetForm()
    ;(window.api as any).workbench = {
      chat: vi.fn().mockResolvedValue({ content: 'AI response here' }),
      chatStream: vi.fn().mockResolvedValue({ streamId: 'test-stream-1' }),
      cancelStream: vi.fn().mockResolvedValue({ ok: true }),
      onChatChunk: vi.fn().mockImplementation((cb: any) => {
        chunkCallback = cb
        return () => {
          chunkCallback = null
        }
      }),
      researchRepo: vi.fn().mockResolvedValue({
        content: 'No matches found',
        filesSearched: [],
        totalMatches: 0
      }),
      checkSpec: vi.fn().mockResolvedValue({}),
      checkOperational: vi.fn().mockResolvedValue({}),
      generateSpec: vi.fn().mockResolvedValue({ spec: '' })
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

  it('sends message via streaming and accumulates chunks', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'What files?' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect((window.api as any).workbench.chatStream).toHaveBeenCalled()
    })

    // Simulate streaming chunks
    chunkCallback!({ streamId: 'test-stream-1', chunk: 'Hello ', done: false })
    chunkCallback!({ streamId: 'test-stream-1', chunk: 'world!', done: false })
    chunkCallback!({ streamId: 'test-stream-1', chunk: '', done: true, fullText: 'Hello world!' })

    await waitFor(() => {
      expect(screen.getByText('Hello world!')).toBeInTheDocument()
    })
  })

  it('clears input after sending', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByText('Send'))

    // Input should be cleared immediately
    expect(textarea.value).toBe('')
  })

  it('shows streaming indicator and hides it when done', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'What is the latest?' } })
    fireEvent.click(screen.getByText('Send'))

    // After chatStream resolves, startStreaming sets copilotLoading + streamingMessageId
    await waitFor(() => {
      expect(screen.getByText('Streaming...')).toBeInTheDocument()
    })

    // Complete the stream
    chunkCallback!({ streamId: 'test-stream-1', chunk: 'Done', done: false })
    chunkCallback!({ streamId: 'test-stream-1', chunk: '', done: true, fullText: 'Done' })

    await waitFor(() => {
      expect(screen.queryByText('Streaming...')).not.toBeInTheDocument()
    })
  })

  it('shows cancel button during streaming and cancels on click', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Long question' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect((window.api as any).workbench.chatStream).toHaveBeenCalled()
    })

    // Simulate first chunk to enter streaming state
    chunkCallback!({ streamId: 'test-stream-1', chunk: 'Partial...', done: false })

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Cancel'))
    expect((window.api as any).workbench.cancelStream).toHaveBeenCalledWith('test-stream-1')
  })

  it('shows error message when stream fails', async () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Try this' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect((window.api as any).workbench.chatStream).toHaveBeenCalled()
    })

    chunkCallback!({
      streamId: 'test-stream-1',
      chunk: '',
      done: true,
      error: 'Claude CLI timed out'
    })

    await waitFor(() => {
      expect(screen.getByText(/Claude CLI timed out/)).toBeInTheDocument()
    })
  })

  it('shows error when chatStream call itself fails', async () => {
    ;(window.api as any).workbench.chatStream = vi
      .fn()
      .mockRejectedValue(new Error('Network error'))

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
      expect((window.api as any).workbench.chatStream).toHaveBeenCalled()
    })
  })

  it('does not send on Shift+Enter', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'No send' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect((window.api as any).workbench.chatStream).not.toHaveBeenCalled()
  })

  it('does not send empty message', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Send'))
    expect((window.api as any).workbench.chatStream).not.toHaveBeenCalled()
  })

  it('does not send whitespace-only message', () => {
    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Send'))
    expect((window.api as any).workbench.chatStream).not.toHaveBeenCalled()
  })

  it('renders multiple messages from store', () => {
    const msgs: CopilotMessage[] = [
      { id: 'sys-1', role: 'system', content: 'Welcome', timestamp: Date.now() },
      { id: 'usr-1', role: 'user', content: 'Hello bot', timestamp: Date.now() },
      {
        id: 'ast-1',
        role: 'assistant',
        content: 'Hi there',
        timestamp: Date.now(),
        insertable: true
      }
    ]
    useTaskWorkbenchStore.setState({ copilotMessages: msgs })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Hello bot')).toBeInTheDocument()
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })

  it('shows "Insert into spec" button for insertable messages', () => {
    const msgs: CopilotMessage[] = [
      {
        id: 'ast-1',
        role: 'assistant',
        content: 'Spec content',
        timestamp: Date.now(),
        insertable: true
      }
    ]
    useTaskWorkbenchStore.setState({ copilotMessages: msgs })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.getByText('Insert into spec')).toBeInTheDocument()
  })

  it('does not show "Insert into spec" for non-insertable messages', () => {
    const msgs: CopilotMessage[] = [
      { id: 'usr-1', role: 'user', content: 'My question', timestamp: Date.now() }
    ]
    useTaskWorkbenchStore.setState({ copilotMessages: msgs })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    expect(screen.queryByText('Insert into spec')).not.toBeInTheDocument()
  })

  it('clicking "Insert into spec" appends to spec field', () => {
    useTaskWorkbenchStore.setState({
      spec: 'Existing spec',
      copilotMessages: [
        {
          id: 'ast-1',
          role: 'assistant',
          content: 'New content',
          timestamp: Date.now(),
          insertable: true
        }
      ]
    })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Insert into spec'))

    expect(useTaskWorkbenchStore.getState().spec).toBe('Existing spec\n\nNew content')
  })

  it('inserting into empty spec does not prepend separator', () => {
    useTaskWorkbenchStore.setState({
      spec: '',
      copilotMessages: [
        {
          id: 'ast-1',
          role: 'assistant',
          content: 'First content',
          timestamp: Date.now(),
          insertable: true
        }
      ]
    })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Insert into spec'))

    expect(useTaskWorkbenchStore.getState().spec).toBe('First content')
  })

  it('filters system messages from chat API call', async () => {
    useTaskWorkbenchStore.setState({
      copilotMessages: [{ id: 'sys-1', role: 'system', content: 'Welcome', timestamp: Date.now() }]
    })

    render(<WorkbenchCopilot onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
    fireEvent.change(textarea, { target: { value: 'Question' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      const call = (window.api as any).workbench.chatStream.mock.calls[0][0]
      // System messages should be filtered out
      const systemMsgs = call.messages.filter((m: any) => m.role === 'system')
      expect(systemMsgs).toHaveLength(0)
    })
  })
})

describe('research integration', () => {
  it('detects research intent in messages', () => {
    expect(isResearchQuery('research the auth module')).toBe(true)
    expect(isResearchQuery('where is the sprint pipeline?')).toBe(true)
    expect(isResearchQuery('find TaskPill component')).toBe(true)
    expect(isResearchQuery('search for useBackoffInterval')).toBe(true)
    expect(isResearchQuery('show me the IPC handlers')).toBe(true)
    expect(isResearchQuery('which file handles sprint tasks?')).toBe(true)
    expect(isResearchQuery('grep the codebase for safeHandle')).toBe(true)
    expect(isResearchQuery('help me write a better title')).toBe(false)
    expect(isResearchQuery('what should the spec include?')).toBe(false)
    expect(isResearchQuery('make this task description clearer')).toBe(false)
  })

  it('extracts search terms from natural language', () => {
    expect(extractSearchTerms('research the codebase for auth module')).toBe('auth module')
    expect(extractSearchTerms('where is the sprint pipeline?')).toBe('sprint pipeline?')
    expect(extractSearchTerms('find TaskPill component')).toBe('TaskPill component')
    expect(extractSearchTerms('search for useBackoffInterval')).toBe('useBackoffInterval')
    expect(extractSearchTerms('show me the IPC handlers')).toBe('IPC handlers')
    expect(extractSearchTerms('grep for safeHandle')).toBe('safeHandle')
  })

  describe('component integration', () => {
    const mockOnClose = vi.fn()
    let chunkCb: ((data: any) => void) | null = null

    beforeEach(() => {
      vi.clearAllMocks()
      chunkCb = null
      localStorage.clear()
      useTaskWorkbenchStore.getState().resetForm()
      useTaskWorkbenchStore.setState({ repo: 'bde' })
      ;(window.api as any).workbench = {
        chat: vi.fn().mockResolvedValue({ content: 'AI response here' }),
        chatStream: vi.fn().mockResolvedValue({ streamId: 'test-stream-1' }),
        cancelStream: vi.fn().mockResolvedValue({ ok: true }),
        onChatChunk: vi.fn().mockImplementation((cb: any) => {
          chunkCb = cb
          return () => {
            chunkCb = null
          }
        }),
        researchRepo: vi.fn().mockResolvedValue({
          content:
            'Found 1 file(s) matching "auth" (showing first 10):\n\n**src/auth.ts**\n1: export function auth()',
          filesSearched: ['src/auth.ts'],
          totalMatches: 1
        }),
        checkSpec: vi.fn().mockResolvedValue({}),
        checkOperational: vi.fn().mockResolvedValue({}),
        generateSpec: vi.fn().mockResolvedValue({ spec: '' })
      }
    })

    it('calls researchRepo and adds system message for research queries', async () => {
      render(<WorkbenchCopilot onClose={mockOnClose} />)
      const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
      fireEvent.change(textarea, { target: { value: 'where is the auth module?' } })
      fireEvent.click(screen.getByText('Send'))

      await waitFor(() => {
        expect((window.api as any).workbench.researchRepo).toHaveBeenCalledWith({
          query: 'auth module?',
          repo: 'bde'
        })
      })

      await waitFor(() => {
        expect(screen.getByText(/Codebase research results/)).toBeInTheDocument()
      })

      // Complete the stream so test can finish cleanly
      chunkCb?.({
        streamId: 'test-stream-1',
        chunk: '',
        done: true,
        fullText: 'Here is what I found.'
      })
    })

    it('skips researchRepo when no repo is configured', async () => {
      useTaskWorkbenchStore.setState({ repo: '' })

      render(<WorkbenchCopilot onClose={mockOnClose} />)
      const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
      fireEvent.change(textarea, { target: { value: 'find the auth handler' } })
      fireEvent.click(screen.getByText('Send'))

      await waitFor(() => {
        expect((window.api as any).workbench.chatStream).toHaveBeenCalled()
      })

      expect((window.api as any).workbench.researchRepo).not.toHaveBeenCalled()

      chunkCb?.({ streamId: 'test-stream-1', chunk: '', done: true, fullText: 'Answer.' })
    })

    it('proceeds without research message when researchRepo throws', async () => {
      ;(window.api as any).workbench.researchRepo = vi
        .fn()
        .mockRejectedValue(new Error('grep failed'))

      render(<WorkbenchCopilot onClose={mockOnClose} />)
      const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
      fireEvent.change(textarea, { target: { value: 'find something' } })
      fireEvent.click(screen.getByText('Send'))

      await waitFor(() => {
        expect((window.api as any).workbench.chatStream).toHaveBeenCalled()
      })

      // Should not show research results
      expect(screen.queryByText(/Codebase research results/)).not.toBeInTheDocument()

      chunkCb?.({ streamId: 'test-stream-1', chunk: '', done: true, fullText: 'Answer.' })
    })

    it('does not call researchRepo for non-research messages', async () => {
      render(<WorkbenchCopilot onClose={mockOnClose} />)
      const textarea = screen.getByPlaceholderText(/Ask about the codebase/)
      fireEvent.change(textarea, { target: { value: 'help me write a better title' } })
      fireEvent.click(screen.getByText('Send'))

      await waitFor(() => {
        expect((window.api as any).workbench.chatStream).toHaveBeenCalled()
      })

      expect((window.api as any).workbench.researchRepo).not.toHaveBeenCalled()

      chunkCb?.({ streamId: 'test-stream-1', chunk: '', done: true, fullText: 'Answer.' })
    })
  })
})
