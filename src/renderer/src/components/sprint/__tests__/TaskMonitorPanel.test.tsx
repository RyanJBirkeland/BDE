import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SprintTask } from '../../../../../shared/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../lib/stream-parser', () => ({
  stripAnsi: vi.fn((s: string) => s)
}))

vi.mock('../../agents/ChatRenderer', () => ({
  ChatRenderer: ({ events }: { events: unknown[] }) => (
    <div data-testid="chat-renderer">Events: {events.length}</div>
  )
}))

vi.mock('../../../stores/sprintEvents', () => ({
  useSprintEvents: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ taskEvents: {} })
  )
}))

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ events: {}, loadHistory: vi.fn().mockResolvedValue(undefined) })
  )
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

Object.defineProperty(window, 'api', {
  value: {
    sprint: {
      readLog: vi.fn().mockResolvedValue({ content: '', status: 'unknown', nextByte: 0 })
    },
    openExternal: vi.fn()
  },
  writable: true,
  configurable: true
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { TaskMonitorPanel } from '../TaskMonitorPanel'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskMonitorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders task title and status badge', () => {
    const task = makeTask({ title: 'Build feature X', status: 'active' })
    render(<TaskMonitorPanel task={task} onClose={vi.fn()} />)
    expect(screen.getByText('Build feature X')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows "no agent session" when task has no agent_run_id', () => {
    const task = makeTask({ agent_run_id: null })
    render(<TaskMonitorPanel task={task} onClose={vi.fn()} />)
    expect(screen.getByText(/No agent session linked/)).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const task = makeTask()
    render(<TaskMonitorPanel task={task} onClose={onClose} />)
    const closeBtn = screen.getAllByRole('button', { name: /close/i })[0]
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows Stop Agent button for active task', () => {
    const onStop = vi.fn()
    const task = makeTask({ status: 'active', agent_run_id: 'run-abc' })
    render(<TaskMonitorPanel task={task} onClose={vi.fn()} onStop={onStop} />)
    expect(screen.getByRole('button', { name: /stop agent/i })).toBeInTheDocument()
  })

  it('shows PR link when task has a PR', () => {
    const task = makeTask({
      agent_run_id: 'run-abc',
      pr_number: 42,
      pr_url: 'https://github.com/org/repo/pull/42'
    })
    render(<TaskMonitorPanel task={task} onClose={vi.fn()} />)
    expect(screen.getByText(/PR #42/)).toBeInTheDocument()
  })
})
