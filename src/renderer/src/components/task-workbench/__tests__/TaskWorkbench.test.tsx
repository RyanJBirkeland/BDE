import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock child components
vi.mock('../WorkbenchForm', () => ({
  WorkbenchForm: ({ onSendCopilotMessage }: { onSendCopilotMessage: (text: string) => void }) => (
    <div data-testid="workbench-form">
      <button data-testid="send-copilot" onClick={() => onSendCopilotMessage('test message')}>
        Send to Copilot
      </button>
    </div>
  )
}))

vi.mock('../WorkbenchCopilot', () => ({
  WorkbenchCopilot: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="workbench-copilot">
      <button data-testid="close-copilot" onClick={onClose}>
        Close
      </button>
    </div>
  )
}))

import { TaskWorkbench } from '../TaskWorkbench'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'
import { useCopilotStore } from '../../../stores/copilot'

describe('TaskWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskWorkbenchStore.getState().resetForm()
    useCopilotStore.getState().reset()

    // Mark the copilot discovery popover as already-seen by default so it
    // doesn't show up in unrelated tests. Tests that want to exercise the
    // popover should call localStorage.removeItem() explicitly.
    window.localStorage.setItem('bde:workbench-copilot-popover-seen', '1')

    // Mock workbench API — now uses chatStream instead of chat
    ;(window.api as any).workbench = {
      chatStream: vi.fn().mockResolvedValue({ streamId: 'test-stream-1' })
    }
  })

  it('renders WorkbenchForm component', () => {
    render(<TaskWorkbench />)
    expect(screen.getByTestId('workbench-form')).toBeInTheDocument()
  })

  it('renders WorkbenchCopilot when copilotVisible is true', () => {
    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)
    expect(screen.getByTestId('workbench-copilot')).toBeInTheDocument()
  })

  it('does not render WorkbenchCopilot when copilotVisible is false', () => {
    useCopilotStore.setState({ visible: false })
    render(<TaskWorkbench />)
    expect(screen.queryByTestId('workbench-copilot')).not.toBeInTheDocument()
  })

  it('shows "AI Copilot" toggle button when copilot is hidden', () => {
    useCopilotStore.setState({ visible: false })
    render(<TaskWorkbench />)
    expect(screen.getByText('AI Copilot')).toBeInTheDocument()
  })

  it('does not show toggle button when copilot is visible', () => {
    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)
    expect(screen.queryByText('AI Copilot')).not.toBeInTheDocument()
  })

  it('toggles copilot visibility when AI Copilot button is clicked', () => {
    useCopilotStore.setState({ visible: false })
    render(<TaskWorkbench />)

    const toggleButton = screen.getByText('AI Copilot')
    fireEvent.click(toggleButton)

    expect(useCopilotStore.getState().visible).toBe(true)
  })

  it('closes copilot when onClose is called', () => {
    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)

    const closeButton = screen.getByTestId('close-copilot')
    fireEvent.click(closeButton)

    expect(useCopilotStore.getState().visible).toBe(false)
  })

  it('sends message via chatStream when handleSendFromForm is called', async () => {
    useTaskWorkbenchStore.setState({
      visible: true,
      title: 'Test Task',
      repo: 'BDE',
      spec: 'Test spec'
    })

    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect((window.api as any).workbench.chatStream).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'test message' }],
        formContext: { title: 'Test Task', repo: 'BDE', spec: 'Test spec' }
      })
    })
  })

  it('shows copilot if hidden when sending message', async () => {
    useCopilotStore.setState({ visible: false })
    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(useCopilotStore.getState().visible).toBe(true)
    })
  })

  it('adds user message to store when sending', async () => {
    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)

    const initialMessageCount = useCopilotStore.getState().messages.length

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      const messages = useCopilotStore.getState().messages
      expect(messages.length).toBeGreaterThan(initialMessageCount)
      expect(messages.some((m) => m.role === 'user' && m.content === 'test message')).toBe(true)
    })
  })

  it('creates empty assistant message and starts streaming state', async () => {
    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      const messages = useCopilotStore.getState().messages
      const assistantMsg = messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg?.insertable).toBe(true)
    })
  })

  it('sets streaming state during chatStream call', async () => {
    let resolveChatStream: (value: any) => void = () => {}
    const chatStreamPromise = new Promise((resolve) => {
      resolveChatStream = resolve
    })
    ;(window.api as any).workbench.chatStream = vi.fn().mockReturnValue(chatStreamPromise)

    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    // Should be in streaming/loading state
    await waitFor(() => {
      const state = useCopilotStore.getState()
      expect(state.streamingMessageId).toBeTruthy()
      expect(state.loading).toBe(true)
    })

    // Resolve the stream initiation
    resolveChatStream({ streamId: 'test-stream-1' })
  })

  it('marks assistant message as insertable', async () => {
    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      const messages = useCopilotStore.getState().messages
      const assistantMsg = messages.find((m) => m.role === 'assistant')
      expect(assistantMsg?.insertable).toBe(true)
    })
  })

  it('sets error message when chatStream call fails', async () => {
    ;(window.api as any).workbench.chatStream = vi
      .fn()
      .mockRejectedValue(new Error('Network error'))

    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      const messages = useCopilotStore.getState().messages
      expect(messages.some((m) => m.content.includes('Failed to reach Claude'))).toBe(true)
    })
  })

  it('clears loading state after error', async () => {
    ;(window.api as any).workbench.chatStream = vi
      .fn()
      .mockRejectedValue(new Error('Network error'))

    useCopilotStore.setState({ visible: true })
    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(useCopilotStore.getState().loading).toBe(false)
    })
  })

  // Note: ResizeObserver behavior tests removed as they conflict with react-resizable-panels
  // internal ResizeObserver usage. The resize behavior is an implementation detail -
  // the important functionality (copilot visibility toggle) is tested elsewhere.

  it('disconnects ResizeObserver on unmount', () => {
    const disconnectMock = vi.fn()
    const OriginalResizeObserver = global.ResizeObserver
    global.ResizeObserver = class MockResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe = vi.fn()
      disconnect = disconnectMock
      unobserve = vi.fn()
    } as any

    const { unmount } = render(<TaskWorkbench />)
    unmount()

    expect(disconnectMock).toHaveBeenCalled()
    global.ResizeObserver = OriginalResizeObserver
  })

  describe('first-run copilot discovery popover', () => {
    const POPOVER_KEY = 'bde:workbench-copilot-popover-seen'

    it('shows the popover on first visit when copilot is hidden', () => {
      window.localStorage.removeItem(POPOVER_KEY)
      useCopilotStore.setState({ visible: false })
      render(<TaskWorkbench />)
      expect(screen.getByRole('dialog', { name: /Meet the AI Copilot/i })).toBeInTheDocument()
    })

    it('does not show the popover when localStorage flag is set', () => {
      window.localStorage.setItem(POPOVER_KEY, '1')
      useCopilotStore.setState({ visible: false })
      render(<TaskWorkbench />)
      expect(screen.queryByRole('dialog', { name: /Meet the AI Copilot/i })).not.toBeInTheDocument()
    })

    it('does not show the popover when copilot is already visible', () => {
      window.localStorage.removeItem(POPOVER_KEY)
      useCopilotStore.setState({ visible: true })
      render(<TaskWorkbench />)
      expect(screen.queryByRole('dialog', { name: /Meet the AI Copilot/i })).not.toBeInTheDocument()
    })

    it('persists dismissal to localStorage and hides on "Got it"', async () => {
      window.localStorage.removeItem(POPOVER_KEY)
      useCopilotStore.setState({ visible: false })
      render(<TaskWorkbench />)

      fireEvent.click(screen.getByRole('button', { name: /got it/i }))

      expect(window.localStorage.getItem(POPOVER_KEY)).toBe('1')
      expect(screen.queryByRole('dialog', { name: /Meet the AI Copilot/i })).not.toBeInTheDocument()
    })

    it('auto-dismisses when user opens the copilot via the toggle', async () => {
      window.localStorage.removeItem(POPOVER_KEY)
      useCopilotStore.setState({ visible: false })
      render(<TaskWorkbench />)

      // Initially the popover is showing
      expect(screen.getByRole('dialog', { name: /Meet the AI Copilot/i })).toBeInTheDocument()

      // User clicks the AI Copilot toggle button
      fireEvent.click(screen.getByText('AI Copilot'))

      // Effect should write the seen key
      await waitFor(() => {
        expect(window.localStorage.getItem(POPOVER_KEY)).toBe('1')
      })
    })
  })

  it('includes form context in chatStream call', async () => {
    useTaskWorkbenchStore.setState({
      visible: true,
      title: 'Build feature X',
      repo: 'life-os',
      spec: '## Problem\nNeed X\n## Solution\nBuild X'
    })

    render(<TaskWorkbench />)

    const sendButton = screen.getByTestId('send-copilot')
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect((window.api as any).workbench.chatStream).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'test message' }],
        formContext: {
          title: 'Build feature X',
          repo: 'life-os',
          spec: '## Problem\nNeed X\n## Solution\nBuild X'
        }
      })
    })
  })
})
