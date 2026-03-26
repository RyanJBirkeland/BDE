import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'

let mockTasks: SprintTask[] = []

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: (selector: (s: { tasks: SprintTask[] }) => unknown) =>
    selector({ tasks: mockTasks })
}))

import { ActiveTasksCard } from '../ActiveTasksCard'

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
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    template_name: null,
    depends_on: null,
    updated_at: '2025-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides
  }
}

describe('ActiveTasksCard', () => {
  beforeEach(() => {
    mockTasks = []
  })

  it('renders card title', () => {
    render(<ActiveTasksCard />)
    expect(screen.getByText('Active Tasks')).toBeInTheDocument()
  })

  it('shows empty state when no active tasks', () => {
    mockTasks = [makeTask({ status: 'backlog' }), makeTask({ status: 'done' })]
    render(<ActiveTasksCard />)
    expect(screen.getByText('No active tasks')).toBeInTheDocument()
  })

  it('shows empty state when tasks array is empty', () => {
    render(<ActiveTasksCard />)
    expect(screen.getByText('No active tasks')).toBeInTheDocument()
  })

  it('shows active tasks', () => {
    mockTasks = [makeTask({ title: 'Fix bug', status: 'active', repo: 'BDE' })]
    render(<ActiveTasksCard />)
    expect(screen.getByText('Fix bug')).toBeInTheDocument()
    expect(screen.getByText('BDE')).toBeInTheDocument()
  })

  it('shows queued tasks', () => {
    mockTasks = [makeTask({ title: 'Queued work', status: 'queued', repo: 'life-os' })]
    render(<ActiveTasksCard />)
    expect(screen.getByText('Queued work')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })

  it('shows blocked tasks', () => {
    mockTasks = [makeTask({ title: 'Blocked item', status: 'blocked' })]
    render(<ActiveTasksCard />)
    expect(screen.getByText('Blocked item')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
  })

  it('filters out done/backlog/cancelled tasks', () => {
    mockTasks = [
      makeTask({ title: 'Done task', status: 'done' }),
      makeTask({ title: 'Backlog task', status: 'backlog' }),
      makeTask({ title: 'Cancelled task', status: 'cancelled' }),
      makeTask({ title: 'Active task', status: 'active' })
    ]
    render(<ActiveTasksCard />)
    expect(screen.queryByText('Done task')).not.toBeInTheDocument()
    expect(screen.queryByText('Backlog task')).not.toBeInTheDocument()
    expect(screen.queryByText('Cancelled task')).not.toBeInTheDocument()
    expect(screen.getByText('Active task')).toBeInTheDocument()
  })

  it('shows multiple active/queued/blocked tasks', () => {
    mockTasks = [
      makeTask({ title: 'Task A', status: 'active' }),
      makeTask({ title: 'Task B', status: 'queued' }),
      makeTask({ title: 'Task C', status: 'blocked' })
    ]
    render(<ActiveTasksCard />)
    expect(screen.getByText('Task A')).toBeInTheDocument()
    expect(screen.getByText('Task B')).toBeInTheDocument()
    expect(screen.getByText('Task C')).toBeInTheDocument()
  })

  it('renders status badge with correct label', () => {
    mockTasks = [makeTask({ title: 'Active one', status: 'active' })]
    render(<ActiveTasksCard />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders repo name for each task', () => {
    mockTasks = [makeTask({ title: 'T1', status: 'active', repo: 'my-repo' })]
    render(<ActiveTasksCard />)
    expect(screen.getByText('my-repo')).toBeInTheDocument()
  })

  it('renders task title with title attribute for tooltip', () => {
    mockTasks = [makeTask({ title: 'A very long task title', status: 'active' })]
    render(<ActiveTasksCard />)
    expect(screen.getByTitle('A very long task title')).toBeInTheDocument()
  })

  it('renders a list when tasks exist', () => {
    mockTasks = [makeTask({ title: 'Task X', status: 'active' })]
    render(<ActiveTasksCard />)
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('does not render a list when empty', () => {
    render(<ActiveTasksCard />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
