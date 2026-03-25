/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SprintTaskList } from '../SprintTaskList'
import type { SprintTask } from '../../../../../shared/types'

const mockTasks: SprintTask[] = [
  {
    id: 'task-1',
    title: 'Implement user authentication',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'active',
    notes: null,
    spec: 'Add OAuth support',
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: 123,
    pr_status: 'open',
    pr_url: 'https://github.com/test/bde/pull/123',
    claimed_by: null,
    started_at: '2024-03-20T10:00:00Z',
    completed_at: null,
    template_name: null,
    depends_on: null,
    updated_at: '2024-03-20T10:00:00Z',
    created_at: '2024-03-20T09:00:00Z',
  },
  {
    id: 'task-2',
    title: 'Fix navbar styling bug',
    repo: 'feast',
    prompt: null,
    priority: 3,
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
    updated_at: '2024-03-19T14:00:00Z',
    created_at: '2024-03-19T14:00:00Z',
  },
  {
    id: 'task-3',
    title: 'Refactor API endpoints',
    repo: 'life-os',
    prompt: null,
    priority: 2,
    status: 'done',
    notes: null,
    spec: null,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: 456,
    pr_status: 'merged',
    pr_url: 'https://github.com/test/life-os/pull/456',
    claimed_by: null,
    started_at: '2024-03-18T08:00:00Z',
    completed_at: '2024-03-18T12:00:00Z',
    template_name: null,
    depends_on: null,
    updated_at: '2024-03-18T12:00:00Z',
    created_at: '2024-03-18T07:00:00Z',
  },
  {
    id: 'task-4',
    title: 'Update documentation',
    repo: 'BDE',
    prompt: null,
    priority: 4,
    status: 'queued',
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
    updated_at: '2024-03-21T09:00:00Z',
    created_at: '2024-03-21T09:00:00Z',
  },
]

describe('SprintTaskList', () => {
  it('renders task list with all tasks', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Implement user authentication')).toBeInTheDocument()
    expect(screen.getByText('Fix navbar styling bug')).toBeInTheDocument()
    expect(screen.getByText('Refactor API endpoints')).toBeInTheDocument()
    expect(screen.getByText('Update documentation')).toBeInTheDocument()
  })

  it('displays correct task count', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    // Should show total count of 4 tasks
    const countBadges = screen.getAllByText('4')
    expect(countBadges.length).toBeGreaterThan(0)
  })

  it('filters tasks by search query', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const searchInput = screen.getByPlaceholderText('Search tasks...')
    fireEvent.change(searchInput, { target: { value: 'authentication' } })

    expect(screen.getByText('Implement user authentication')).toBeInTheDocument()
    expect(screen.queryByText('Fix navbar styling bug')).not.toBeInTheDocument()
  })

  it('filters tasks by status', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const backlogFilter = screen.getByText('Backlog')
    fireEvent.click(backlogFilter)

    expect(screen.getByText('Fix navbar styling bug')).toBeInTheDocument()
    expect(screen.queryByText('Implement user authentication')).not.toBeInTheDocument()
  })

  it('filters tasks by done status', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const doneFilter = screen.getByText('Done')
    fireEvent.click(doneFilter)

    expect(screen.getByText('Refactor API endpoints')).toBeInTheDocument()
    expect(screen.queryByText('Implement user authentication')).not.toBeInTheDocument()
  })

  it('calls onSelectTask when task is clicked', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const taskButton = screen.getByText('Implement user authentication').closest('button')
    fireEvent.click(taskButton!)

    expect(onSelectTask).toHaveBeenCalledWith(mockTasks[0])
  })

  it('highlights selected task', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId="task-1" onSelectTask={onSelectTask} />)

    const taskButton = screen.getByText('Implement user authentication').closest('button')
    expect(taskButton).toHaveClass('sprint-task-list-item--selected')
  })

  it('clears search when clear button is clicked', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const searchInput = screen.getByPlaceholderText('Search tasks...') as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: 'authentication' } })

    expect(searchInput.value).toBe('authentication')

    const clearButton = screen.getByLabelText('Clear search')
    fireEvent.click(clearButton)

    expect(searchInput.value).toBe('')
  })

  it('displays empty state when no tasks match filter', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const searchInput = screen.getByPlaceholderText('Search tasks...')
    fireEvent.change(searchInput, { target: { value: 'nonexistent task xyz' } })

    expect(screen.getByText('No tasks match your search')).toBeInTheDocument()
  })

  it('displays PR number for tasks with open PRs', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    expect(screen.getByText('#123')).toBeInTheDocument()
    expect(screen.getByText('#456')).toBeInTheDocument()
  })

  it('applies repo filter when provided', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} repoFilter="BDE" />)

    expect(screen.getByText('Implement user authentication')).toBeInTheDocument()
    expect(screen.getByText('Update documentation')).toBeInTheDocument()
    expect(screen.queryByText('Fix navbar styling bug')).not.toBeInTheDocument()
    expect(screen.queryByText('Refactor API endpoints')).not.toBeInTheDocument()
  })

  it('disables filter chips with zero count', () => {
    const onSelectTask = vi.fn()
    const tasksWithNoFailed = mockTasks.filter((t) => t.status !== 'failed')
    render(<SprintTaskList tasks={tasksWithNoFailed} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const failedFilter = screen.getByText('Failed')
    expect(failedFilter).toBeDisabled()
  })

  it('displays priority badge for high priority tasks', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    // Task 1 has priority 1, should show P1 badge
    expect(screen.getByText('P1')).toBeInTheDocument()
    // Task 3 has priority 2, should show P2 badge
    expect(screen.getByText('P2')).toBeInTheDocument()
  })
})
