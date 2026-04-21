import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockSendMessage, mockAbortStream, mockAutoReview, mockAppendQuickAction } = vi.hoisted(
  () => ({
    mockSendMessage: vi.fn().mockResolvedValue(undefined),
    mockAbortStream: vi.fn().mockResolvedValue(undefined),
    mockAutoReview: vi.fn().mockResolvedValue(undefined),
    mockAppendQuickAction: vi.fn().mockResolvedValue(undefined)
  })
)

const { mockTogglePanel, mockClearMessages } = vi.hoisted(() => ({
  mockTogglePanel: vi.fn(),
  mockClearMessages: vi.fn()
}))

const partnerState = vi.hoisted(() => ({
  panelOpen: false,
  reviewByTask: {} as Record<string, { status: string; result?: unknown; error?: string }>,
  messagesByTask: {} as Record<string, unknown[]>,
  activeStreamByTask: {} as Record<string, string | null>,
  togglePanel: mockTogglePanel,
  clearMessages: mockClearMessages
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: null as string | null
  }))
  return { useCodeReviewStore: store }
})

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: { tasks: unknown[] }) => unknown) => sel({ tasks: [] }))
}))

vi.mock('../../../stores/reviewPartner', () => ({
  useReviewPartnerStore: vi.fn((sel: (s: typeof partnerState) => unknown) => sel(partnerState))
}))

vi.mock('../../../hooks/useReviewPartnerActions', () => ({
  useReviewPartnerActions: vi.fn(() => ({
    autoReview: mockAutoReview,
    sendMessage: mockSendMessage,
    abortStream: mockAbortStream,
    appendQuickAction: mockAppendQuickAction
  }))
}))

vi.mock('../ReviewMetricsRow', () => ({
  ReviewMetricsRow: ({ loading }: { loading?: boolean }) => (
    <div data-testid="review-metrics-row" data-loading={loading ? 'true' : 'false'} />
  )
}))

vi.mock('../ReviewMessageList', () => ({
  ReviewMessageList: ({
    messages,
    emptyMessage
  }: {
    messages: unknown[]
    emptyMessage?: string
  }) =>
    messages.length === 0 ? (
      <div data-testid="review-message-list-empty">{emptyMessage}</div>
    ) : (
      <div data-testid="review-message-list">{messages.length} messages</div>
    )
}))

vi.mock('../ReviewQuickActions', () => ({
  ReviewQuickActions: ({
    onAction,
    disabled
  }: {
    onAction: (p: string) => void
    disabled?: boolean
  }) => (
    <div data-testid="review-quick-actions" data-disabled={disabled ? 'true' : 'false'}>
      <button onClick={() => onAction('test-prompt')} disabled={disabled}>
        Quick action
      </button>
    </div>
  )
}))

vi.mock('../ReviewChatInput', () => ({
  ReviewChatInput: ({
    onSend,
    onAbort,
    streaming,
    disabled
  }: {
    onSend: (c: string) => void
    onAbort?: () => void
    streaming?: boolean
    disabled?: boolean
  }) => (
    <div data-testid="review-chat-input">
      <button onClick={() => onSend('hello')} disabled={disabled}>
        Send
      </button>
      {streaming && <button onClick={onAbort}>Abort</button>}
    </div>
  )
}))

import { AIAssistantPanel } from '../AIAssistantPanel'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('AIAssistantPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCodeReviewStore.setState({ selectedTaskId: null })
    partnerState.reviewByTask = {}
    partnerState.messagesByTask = {}
    partnerState.activeStreamByTask = {}
  })

  it('renders header with AI Review Partner title', () => {
    render(<AIAssistantPanel />)
    expect(screen.getByText('AI Review Partner')).toBeInTheDocument()
    // Model label was removed — the actual model comes from Settings → Models
    // and the header no longer advertises a specific value it can't verify.
    expect(screen.queryByText(/Claude \d/)).not.toBeInTheDocument()
  })

  it('renders close button that calls togglePanel', () => {
    render(<AIAssistantPanel />)
    const closeBtn = screen.getByRole('button', { name: 'Close AI Review Partner' })
    fireEvent.click(closeBtn)
    expect(mockTogglePanel).toHaveBeenCalledTimes(1)
  })

  it('renders More options menu button', () => {
    render(<AIAssistantPanel />)
    const menuBtn = screen.getByRole('button', { name: 'More options' })
    expect(menuBtn).toBeInTheDocument()
  })

  it('opens menu on click and shows Re-review and Clear thread items', () => {
    render(<AIAssistantPanel />)
    const menuBtn = screen.getByRole('button', { name: 'More options' })
    fireEvent.click(menuBtn)
    expect(screen.getByRole('menuitem', { name: 'Re-review' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Clear thread' })).toBeInTheDocument()
  })

  it('menu items are disabled when no task selected', () => {
    useCodeReviewStore.setState({ selectedTaskId: null })
    render(<AIAssistantPanel />)
    const menuBtn = screen.getByRole('button', { name: 'More options' })
    fireEvent.click(menuBtn)
    expect(screen.getByRole('menuitem', { name: 'Re-review' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Clear thread' })).toBeDisabled()
  })

  it('Re-review calls autoReview with force:true', () => {
    useCodeReviewStore.setState({ selectedTaskId: 'task-abc' })
    render(<AIAssistantPanel />)
    const menuBtn = screen.getByRole('button', { name: 'More options' })
    fireEvent.click(menuBtn)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Re-review' }))
    expect(mockAutoReview).toHaveBeenCalledWith('task-abc', { force: true })
  })

  it('Clear thread calls clearMessages', () => {
    useCodeReviewStore.setState({ selectedTaskId: 'task-abc' })
    render(<AIAssistantPanel />)
    const menuBtn = screen.getByRole('button', { name: 'More options' })
    fireEvent.click(menuBtn)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear thread' }))
    expect(mockClearMessages).toHaveBeenCalledWith('task-abc')
  })

  it('renders ReviewMetricsRow', () => {
    render(<AIAssistantPanel />)
    expect(screen.getByTestId('review-metrics-row')).toBeInTheDocument()
  })

  it('shows empty message when no task selected', () => {
    useCodeReviewStore.setState({ selectedTaskId: null })
    render(<AIAssistantPanel />)
    expect(screen.getByText('Select a task to start reviewing.')).toBeInTheDocument()
  })

  it('shows loading message when review is loading', () => {
    useCodeReviewStore.setState({ selectedTaskId: 'task-1' })
    partnerState.reviewByTask = { 'task-1': { status: 'loading' } }
    render(<AIAssistantPanel />)
    expect(screen.getByText('Reviewing...')).toBeInTheDocument()
  })

  it('shows error alert when review errored', () => {
    useCodeReviewStore.setState({ selectedTaskId: 'task-1' })
    partnerState.reviewByTask = { 'task-1': { status: 'error', error: 'Something went wrong' } }
    render(<AIAssistantPanel />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('error Retry button calls autoReview', () => {
    useCodeReviewStore.setState({ selectedTaskId: 'task-1' })
    partnerState.reviewByTask = { 'task-1': { status: 'error', error: 'Failed' } }
    render(<AIAssistantPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mockAutoReview).toHaveBeenCalledWith('task-1', { force: true })
  })

  it('renders ReviewQuickActions disabled when no task', () => {
    useCodeReviewStore.setState({ selectedTaskId: null })
    render(<AIAssistantPanel />)
    const qa = screen.getByTestId('review-quick-actions')
    expect(qa.dataset.disabled).toBe('true')
  })

  it('renders ReviewChatInput', () => {
    render(<AIAssistantPanel />)
    expect(screen.getByTestId('review-chat-input')).toBeInTheDocument()
  })

  it('sends message via sendMessage action', () => {
    useCodeReviewStore.setState({ selectedTaskId: 'task-1' })
    render(<AIAssistantPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mockSendMessage).toHaveBeenCalledWith('task-1', 'hello')
  })

  it('aborts stream via abortStream action', () => {
    useCodeReviewStore.setState({ selectedTaskId: 'task-1' })
    partnerState.activeStreamByTask = { 'task-1': 'stream-id-123' }
    render(<AIAssistantPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))
    expect(mockAbortStream).toHaveBeenCalledWith('task-1')
  })
})
