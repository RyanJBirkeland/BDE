/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SprintTaskList } from '../SprintTaskList'
import { useSprintUI } from '../../../stores/sprintUI'
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
    created_at: '2024-03-20T09:00:00Z'
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
    created_at: '2024-03-19T14:00:00Z'
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
    created_at: '2024-03-18T07:00:00Z'
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
    created_at: '2024-03-21T09:00:00Z'
  }
]

describe('SprintTaskList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSprintUI.setState({ searchQuery: '', statusFilter: 'all' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders task list with all tasks', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    expect(screen.getByText('Implement user authentication')).toBeInTheDocument()
    expect(screen.getByText('Fix navbar styling bug')).toBeInTheDocument()
    expect(screen.getByText('Update documentation')).toBeInTheDocument()
    // Done tasks are collapsed by default — expand to verify
    const doneEls = screen.getAllByText('Done')
    const doneGroup = doneEls
      .find((el) => el.closest('.sprint-task-list__group-header'))!
      .closest('button')!
    fireEvent.click(doneGroup)
    expect(screen.getByText('Refactor API endpoints')).toBeInTheDocument()
  })

  it('renders all status groups', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    expect(screen.getByText('Awaiting Review')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })

  it('filters tasks by search query (after debounce)', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const searchInput = screen.getByPlaceholderText('Search tasks...')
    fireEvent.change(searchInput, { target: { value: 'authentication' } })

    // Advance past SEARCH_DEBOUNCE_MS (150ms)
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByText('Implement user authentication')).toBeInTheDocument()
    expect(screen.queryByText('Fix navbar styling bug')).not.toBeInTheDocument()
  })

  it('filters tasks by status via store', () => {
    const onSelectTask = vi.fn()
    useSprintUI.setState({ statusFilter: 'backlog' })
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    expect(screen.getByText('Fix navbar styling bug')).toBeInTheDocument()
    expect(screen.queryByText('Implement user authentication')).not.toBeInTheDocument()
  })

  it('filters tasks by done status via store', () => {
    const onSelectTask = vi.fn()
    useSprintUI.setState({ statusFilter: 'done' })
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    useSprintUI.setState({ statusFilter: 'done' })

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

    // Advance past debounce so clear button appears
    act(() => {
      vi.advanceTimersByTime(200)
    })

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

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByText('No tasks match your search')).toBeInTheDocument()
  })

  it('displays PR number for tasks with open PRs', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    expect(screen.getByText('#123')).toBeInTheDocument()
    // #456 is on a done task — expand Done group
    const doneEls = screen.getAllByText('Done')
    const doneGroup = doneEls
      .find((el) => el.closest('.sprint-task-list__group-header'))!
      .closest('button')!
    fireEvent.click(doneGroup)
    expect(screen.getByText('#456')).toBeInTheDocument()
  })

  it('applies repo filter when provided', () => {
    const onSelectTask = vi.fn()
    render(
      <SprintTaskList
        tasks={mockTasks}
        selectedTaskId={null}
        onSelectTask={onSelectTask}
        repoFilter="BDE"
      />
    )

    expect(screen.getByText('Implement user authentication')).toBeInTheDocument()
    expect(screen.getByText('Update documentation')).toBeInTheDocument()
    expect(screen.queryByText('Fix navbar styling bug')).not.toBeInTheDocument()
    expect(screen.queryByText('Refactor API endpoints')).not.toBeInTheDocument()
  })

  it('shows colored accent dots on group headers', () => {
    const onSelectTask = vi.fn()

    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    const groupDots = document.querySelectorAll('.sprint-task-list__group-dot')
    expect(groupDots.length).toBeGreaterThan(0)
  })

  it('displays priority badge for high priority tasks', () => {
    const onSelectTask = vi.fn()
    render(<SprintTaskList tasks={mockTasks} selectedTaskId={null} onSelectTask={onSelectTask} />)

    // Task 1 has priority 1, should show P1 badge
    expect(screen.getByText('P1')).toBeInTheDocument()
    // Task 3 has priority 2 and is done — expand Done group
    const doneEls = screen.getAllByText('Done')
    const doneGroup = doneEls
      .find((el) => el.closest('.sprint-task-list__group-header'))!
      .closest('button')!
    fireEvent.click(doneGroup)
    expect(screen.getByText('P2')).toBeInTheDocument()
  })
})
