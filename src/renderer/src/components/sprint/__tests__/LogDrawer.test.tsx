import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('../../../lib/stream-parser', () => ({
  stripAnsi: vi.fn((s: string) => s)
}))

vi.mock('../../agents/ChatRenderer', () => ({
  ChatRenderer: ({ events }: { events: unknown[] }) => (
    <div data-testid="chat-renderer">Events: {events.length}</div>
  )
}))

vi.mock('../../../stores/sprintEvents', () => ({
  useSprintEvents: vi.fn()
}))

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn()
}))

vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
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
    retry_count: 0,
    fast_fail_count: 0,
    template_name: null,
    depends_on: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides
  }
}

import { LogDrawer } from '../LogDrawer'

describe('LogDrawer', () => {
  const onClose = vi.fn()
  const mockLoadHistory = vi.fn().mockResolvedValue(undefined)

  beforeEach(async () => {
    vi.clearAllMocks()
    const { useSprintEvents } = await import('../../../stores/sprintEvents')
    const { useAgentEventsStore } = await import('../../../stores/agentEvents')
    vi.mocked(useSprintEvents).mockReturnValue(undefined)
    vi.mocked(useAgentEventsStore).mockImplementation((sel: any) =>
      sel({ events: {}, loadHistory: mockLoadHistory })
    )
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

  it('shows empty state when agent_run_id is provided but no events or log', () => {
    const task = makeTask({ agent_run_id: 'run-123' })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(screen.getByText('Agent is starting up...')).toBeInTheDocument()
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
    vi.mocked(window.api.sprint.readLog).mockResolvedValue({
      content: '',
      status: 'done',
      nextByte: 0
    })

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

  it('Open in Agents button dispatches bde:navigate event', async () => {
    const user = userEvent.setup()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const task = makeTask({ agent_run_id: 'session-abc' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Open in Agents' }))

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bde:navigate',
        detail: { view: 'agents', sessionId: 'session-abc' }
      })
    )
    expect(onClose).toHaveBeenCalled()
    dispatchSpy.mockRestore()
  })

  it('renders plain text log content when available and no events', async () => {
    vi.mocked(window.api.sprint.readLog).mockResolvedValue({
      content: 'Hello from the agent log',
      status: 'running',
      nextByte: 24
    })

    const task = makeTask({ agent_run_id: 'run-plain', status: 'done' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Hello from the agent log')).toBeInTheDocument()
    })
  })

  it('shows failed status label when agent fails', async () => {
    vi.mocked(window.api.sprint.readLog).mockResolvedValue({
      content: '',
      status: 'failed',
      nextByte: 0
    })

    const task = makeTask({ agent_run_id: 'run-fail', status: 'done' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText(/failed/)).toBeInTheDocument()
    })
  })

  it('shows running status label when agent is running', async () => {
    vi.mocked(window.api.sprint.readLog).mockResolvedValue({
      content: '',
      status: 'running',
      nextByte: 0
    })

    const task = makeTask({ agent_run_id: 'run-running', status: 'active' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText(/running/)).toBeInTheDocument()
    })
  })

  it('shows steer input when task is active with agent_run_id', () => {
    const task = makeTask({ agent_run_id: 'run-active', status: 'active' })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(screen.getByPlaceholderText(/Send message to agent/)).toBeInTheDocument()
  })

  it('does not show steer input when task is not active', () => {
    const task = makeTask({ agent_run_id: 'run-done', status: 'done' })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(screen.queryByPlaceholderText(/Send message to agent/)).not.toBeInTheDocument()
  })

  it('Send button calls steerAgent with input text', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.steerAgent).mockResolvedValue({ ok: true })

    const task = makeTask({ agent_run_id: 'run-active', status: 'active' })
    render(<LogDrawer task={task} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/Send message to agent/)
    await user.type(input, 'Please check the tests')
    await user.click(screen.getByRole('button', { name: /Send/ }))

    await waitFor(() => {
      expect(window.api.steerAgent).toHaveBeenCalledWith('run-active', 'Please check the tests')
    })
  })

  it('shows Stop Agent button when task is active and onStop is provided', () => {
    const onStop = vi.fn()
    const task = makeTask({ agent_run_id: 'run-active', status: 'active' })
    render(<LogDrawer task={task} onClose={onClose} onStop={onStop} />)

    expect(screen.getByRole('button', { name: 'Stop Agent' })).toBeInTheDocument()
  })

  it('Stop Agent button calls onStop with the task', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const task = makeTask({ agent_run_id: 'run-active', status: 'active' })
    render(<LogDrawer task={task} onClose={onClose} onStop={onStop} />)

    await user.click(screen.getByRole('button', { name: 'Stop Agent' }))

    expect(onStop).toHaveBeenCalledWith(task)
  })

  it('loads agentEvents history on mount when agent_run_id exists', () => {
    const task = makeTask({ agent_run_id: 'run-history' })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(mockLoadHistory).toHaveBeenCalledWith('run-history')
  })

  it('renders ChatRenderer when agentEvents exist and no sprint task events', async () => {
    const { useAgentEventsStore } = await import('../../../stores/agentEvents')
    vi.mocked(useAgentEventsStore).mockImplementation((sel: any) =>
      sel({
        events: {
          'run-chat': [{ type: 'text', content: 'Hello', timestamp: Date.now() }]
        },
        loadHistory: mockLoadHistory
      })
    )

    const task = makeTask({ agent_run_id: 'run-chat', status: 'done' })
    render(<LogDrawer task={task} onClose={onClose} />)

    expect(screen.getByTestId('chat-renderer')).toBeInTheDocument()
  })

  it('shows Re-run button when onRerun provided and agent failed', async () => {
    vi.mocked(window.api.sprint.readLog).mockResolvedValue({
      content: '',
      status: 'failed',
      nextByte: 0
    })

    const onRerun = vi.fn()
    const task = makeTask({ agent_run_id: 'run-fail', status: 'active' })
    render(<LogDrawer task={task} onClose={onClose} onRerun={onRerun} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Re-run/ })).toBeInTheDocument()
    })
  })

  it('Copy Log button copies log to clipboard', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.sprint.readLog).mockResolvedValue({
      content: 'log line 1',
      status: 'done',
      nextByte: 10
    })

    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true
    })

    const task = makeTask({ agent_run_id: 'run-copy', status: 'done' })
    render(<LogDrawer task={task} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('log line 1')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Copy Log/ }))

    expect(writeTextMock).toHaveBeenCalledWith('log line 1')
  })
})
