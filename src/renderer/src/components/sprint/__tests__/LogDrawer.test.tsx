import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('../../../lib/stream-parser', () => ({
  parseStreamJson: vi.fn().mockReturnValue({ items: [{ type: 'text', content: 'hello' }], isStreaming: false }),
  stripAnsi: vi.fn((s: string) => s),
}))

vi.mock('../../../lib/taskRunnerSSE', () => ({
  subscribeSSE: vi.fn().mockReturnValue(() => {}),
}))

vi.mock('../../../lib/agent-messages', () => ({
  chatItemsToMessages: vi.fn().mockReturnValue([]),
}))

vi.mock('../../sessions/ChatThread', () => ({
  ChatThread: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="chat-thread">Messages: {messages.length}</div>
  ),
}))

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'backlog',
    notes: null,
    spec: null,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

import { LogDrawer } from '../LogDrawer'

describe('LogDrawer', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders null when task is null', () => {
    const { container } = render(<LogDrawer task={null} onClose={onClose} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders drawer when task is provided', () => {
    const task = makeTask({ agent_run_id: 'abc12345-full-id' })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(screen.getByText('agent/abc12345')).toBeInTheDocument()
    expect(screen.getByText('BDE')).toBeInTheDocument()
  })

  it('shows empty state when task has no agent_run_id', () => {
    const task = makeTask({ agent_run_id: null })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(screen.getByText('No agent session linked to this task.')).toBeInTheDocument()
  })

  it('shows ChatThread when agent_run_id is provided', () => {
    const task = makeTask({ agent_run_id: 'run-123' })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(screen.getByTestId('chat-thread')).toBeInTheDocument()
  })

  it('fetches log content on mount when agent_run_id exists', async () => {
    const readLog = vi.mocked(window.api.sprint.readLog)
    readLog.mockResolvedValue({ content: 'log data', status: 'done', nextByte: 8 })

    const task = makeTask({ agent_run_id: 'run-456' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await waitFor(() => {
      expect(readLog).toHaveBeenCalledWith('run-456', 0)
    })
  })

  it('shows status label for done agent', async () => {
    vi.mocked(window.api.sprint.readLog).mockResolvedValue({ content: '', status: 'done', nextByte: 0 })

    const task = makeTask({ agent_run_id: 'run-789', status: 'done' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText(/done/)).toBeInTheDocument()
    })
  })

  it('close button calls onClose', async () => {
    const user = userEvent.setup()
    const task = makeTask()
    render(<LogDrawer task={task} onClose={onClose} />)

    const closeButtons = screen.getAllByRole('button', { name: /Close|✕/ })
    await user.click(closeButtons[closeButtons.length - 1])

    expect(onClose).toHaveBeenCalled()
  })

  it('Open in Sessions button dispatches bde:navigate event', async () => {
    const user = userEvent.setup()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const task = makeTask({ agent_run_id: 'session-abc' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Open in Sessions' }))

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bde:navigate',
        detail: { view: 'sessions', sessionId: 'session-abc' },
      })
    )
    expect(onClose).toHaveBeenCalled()
    dispatchSpy.mockRestore()
  })
})
