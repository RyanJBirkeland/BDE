import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'

let mockTasks: SprintTask[] = []

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: (selector: (s: { tasks: SprintTask[] }) => unknown) =>
    selector({ tasks: mockTasks })
}))

import { RecentCompletionsCard } from '../RecentCompletionsCard'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'done',
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

describe('RecentCompletionsCard', () => {
  beforeEach(() => {
    mockTasks = []
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders card title', () => {
    render(<RecentCompletionsCard />)
    expect(screen.getByText('Recent Completions')).toBeInTheDocument()
  })

  it('shows empty state when no completed tasks', () => {
    mockTasks = [makeTask({ status: 'active' }), makeTask({ status: 'queued' })]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('No completed tasks yet')).toBeInTheDocument()
  })

  it('shows empty state when tasks array is empty', () => {
    render(<RecentCompletionsCard />)
    expect(screen.getByText('No completed tasks yet')).toBeInTheDocument()
  })

  it('shows completed tasks', () => {
    mockTasks = [
      makeTask({ title: 'Finished task', status: 'done', completed_at: '2025-06-15T11:30:00Z' })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('Finished task')).toBeInTheDocument()
  })

  it('formats timestamp as "just now" for < 1 minute', () => {
    mockTasks = [
      makeTask({ title: 'Recent', status: 'done', completed_at: '2025-06-15T11:59:50Z' })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('formats timestamp as minutes ago', () => {
    mockTasks = [
      makeTask({ title: 'A few mins', status: 'done', completed_at: '2025-06-15T11:45:00Z' })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('15m ago')).toBeInTheDocument()
  })

  it('formats timestamp as hours ago', () => {
    mockTasks = [
      makeTask({ title: 'Hours ago', status: 'done', completed_at: '2025-06-15T09:00:00Z' })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('3h ago')).toBeInTheDocument()
  })

  it('formats timestamp as days ago', () => {
    mockTasks = [
      makeTask({ title: 'Days ago', status: 'done', completed_at: '2025-06-13T12:00:00Z' })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('2d ago')).toBeInTheDocument()
  })

  it('uses updated_at as fallback when completed_at is null', () => {
    mockTasks = [
      makeTask({
        title: 'Fallback',
        status: 'done',
        completed_at: null,
        updated_at: '2025-06-15T11:00:00Z'
      })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('1h ago')).toBeInTheDocument()
  })

  it('limits to 5 most recent completions', () => {
    mockTasks = Array.from({ length: 8 }, (_, i) =>
      makeTask({
        title: `Task ${i}`,
        status: 'done',
        completed_at: `2025-06-15T${String(11 - i).padStart(2, '0')}:00:00Z`
      })
    )
    render(<RecentCompletionsCard />)
    expect(screen.getByText('Task 0')).toBeInTheDocument()
    expect(screen.getByText('Task 4')).toBeInTheDocument()
    expect(screen.queryByText('Task 5')).not.toBeInTheDocument()
  })

  it('sorts by completed_at descending (most recent first)', () => {
    mockTasks = [
      makeTask({ title: 'Older', status: 'done', completed_at: '2025-06-15T08:00:00Z' }),
      makeTask({ title: 'Newer', status: 'done', completed_at: '2025-06-15T11:00:00Z' })
    ]
    render(<RecentCompletionsCard />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Newer')
    expect(items[1]).toHaveTextContent('Older')
  })

  it('filters out non-done tasks', () => {
    mockTasks = [
      makeTask({ title: 'Active task', status: 'active' }),
      makeTask({ title: 'Done task', status: 'done', completed_at: '2025-06-15T11:00:00Z' })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.queryByText('Active task')).not.toBeInTheDocument()
    expect(screen.getByText('Done task')).toBeInTheDocument()
  })

  it('renders a list when completed tasks exist', () => {
    mockTasks = [makeTask({ title: 'Done', status: 'done', completed_at: '2025-06-15T11:00:00Z' })]
    render(<RecentCompletionsCard />)
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('does not render a list when empty', () => {
    render(<RecentCompletionsCard />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('renders title attribute for tooltip on task titles', () => {
    mockTasks = [
      makeTask({ title: 'Tooltip task', status: 'done', completed_at: '2025-06-15T11:00:00Z' })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByTitle('Tooltip task')).toBeInTheDocument()
  })

  it('handles task with null completed_at falling back to updated_at', () => {
    mockTasks = [
      makeTask({
        title: 'Null completed',
        status: 'done',
        completed_at: null,
        updated_at: '2025-06-15T11:30:00Z'
      })
    ]
    render(<RecentCompletionsCard />)
    expect(screen.getByText('Null completed')).toBeInTheDocument()
    expect(screen.getByText('30m ago')).toBeInTheDocument()
  })
})
