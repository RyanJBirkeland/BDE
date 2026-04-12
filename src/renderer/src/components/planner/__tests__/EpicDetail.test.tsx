import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EpicDetail } from '../EpicDetail'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'

describe('EpicDetail', () => {
  const mockGroup: TaskGroup = {
    id: 'group-1',
    name: 'Authentication Epic',
    icon: '🔐',
    accent_color: '#00ffff',
    goal: 'Implement secure user authentication',
    status: 'draft',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    depends_on: null
  }

  const mockTasks: SprintTask[] = [
    {
      id: 'task-1',
      title: 'Add login form',
      repo: 'test-repo',
      prompt: null,
      spec: 'Detailed spec here',
      priority: 1,
      status: 'done',
      notes: null,
      retry_count: 0,
      fast_fail_count: 0,
      agent_run_id: null,
      pr_number: null,
      pr_status: null,
      pr_url: null,
      claimed_by: null,
      started_at: null,
      completed_at: null,
      failure_reason: null,
      depends_on: null,
      playground_enabled: false,
      max_runtime_ms: null,
      group_id: 'group-1',
      template_name: null,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'task-2',
      title: 'Add password reset',
      repo: 'test-repo',
      prompt: null,
      spec: 'Another spec',
      priority: 2,
      status: 'active',
      notes: null,
      retry_count: 0,
      fast_fail_count: 0,
      agent_run_id: null,
      pr_number: null,
      pr_status: null,
      pr_url: null,
      claimed_by: null,
      started_at: null,
      completed_at: null,
      failure_reason: null,
      depends_on: [{ id: 'task-1', type: 'hard' }],
      playground_enabled: false,
      max_runtime_ms: null,
      group_id: 'group-1',
      template_name: null,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'task-3',
      title: 'Task without spec',
      repo: 'test-repo',
      prompt: null,
      spec: '',
      priority: 3,
      status: 'backlog',
      notes: null,
      retry_count: 0,
      fast_fail_count: 0,
      agent_run_id: null,
      pr_number: null,
      pr_status: null,
      pr_url: null,
      claimed_by: null,
      started_at: null,
      completed_at: null,
      failure_reason: null,
      depends_on: null,
      playground_enabled: false,
      max_runtime_ms: null,
      group_id: 'group-1',
      template_name: null,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z'
    }
  ]

  const defaultProps = {
    group: mockGroup,
    tasks: mockTasks,
    onQueueAll: vi.fn(),
    onAddTask: vi.fn(),
    onEditTask: vi.fn()
  }

  it('should render epic header with icon, name, and goal', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('Authentication Epic')).toBeInTheDocument()
    expect(screen.getByText('Implement secure user authentication')).toBeInTheDocument()
    expect(screen.getByText('🔐'.charAt(0).toUpperCase())).toBeInTheDocument()
  })

  it('should render overflow menu button', () => {
    render(<EpicDetail {...defaultProps} onEditGroup={vi.fn()} />)

    const menuButton = screen.getByLabelText('More options')
    expect(menuButton).toBeInTheDocument()
  })

  it('should always render overflow menu button', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByLabelText('More options')).toBeInTheDocument()
  })

  it('should display status breakdown correctly', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('1 done')).toBeInTheDocument()
    expect(screen.getByText('1 active')).toBeInTheDocument()
    expect(screen.getByText('0 queued')).toBeInTheDocument()
    expect(screen.getByText('0 blocked')).toBeInTheDocument()
    expect(screen.getByText('1 draft')).toBeInTheDocument()
  })

  it('should show readiness warning when tasks missing specs', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('1 task missing specs')).toBeInTheDocument()
  })

  it('should show plural warning when multiple tasks missing specs', () => {
    const tasksWithMultipleMissingSpecs: SprintTask[] = [
      ...mockTasks,
      {
        ...mockTasks[2],
        id: 'task-4',
        title: 'Another task without spec'
      }
    ]

    render(<EpicDetail {...defaultProps} tasks={tasksWithMultipleMissingSpecs} />)

    expect(screen.getByText('2 tasks missing specs')).toBeInTheDocument()
  })

  it('should not show readiness warning when all backlog tasks have specs', () => {
    const tasksWithSpecs = mockTasks.filter((t) => t.spec)
    render(<EpicDetail {...defaultProps} tasks={tasksWithSpecs} />)

    expect(screen.queryByText(/missing specs/)).not.toBeInTheDocument()
  })

  it('should render all tasks in the list', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('Add login form')).toBeInTheDocument()
    expect(screen.getByText('Add password reset')).toBeInTheDocument()
    expect(screen.getByText('Task without spec')).toBeInTheDocument()
  })

  it('should show "no spec" flag for backlog tasks without specs', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('no spec')).toBeInTheDocument()
  })

  it('should not show "no spec" flag for tasks with specs', () => {
    const tasksWithSpecs = mockTasks.filter((t) => t.spec)
    render(<EpicDetail {...defaultProps} tasks={tasksWithSpecs} />)

    expect(screen.queryByText('no spec')).not.toBeInTheDocument()
  })

  it('should show dependency reference when task has dependencies', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('1 dep')).toBeInTheDocument()
  })

  it('should show plural dependency reference', () => {
    const tasksWithMultipleDeps: SprintTask[] = mockTasks.map((t) =>
      t.id === 'task-2'
        ? {
            ...t,
            depends_on: [
              { id: 'task-1', type: 'hard' },
              { id: 'task-3', type: 'soft' }
            ]
          }
        : t
    )

    render(<EpicDetail {...defaultProps} tasks={tasksWithMultipleDeps} />)

    expect(screen.getByText('2 deps')).toBeInTheDocument()
  })

  it('should call onEditTask when edit button is clicked', async () => {
    const user = userEvent.setup()
    const onEditTask = vi.fn()
    render(<EpicDetail {...defaultProps} onEditTask={onEditTask} />)

    const editButton = screen.getByLabelText('Edit Add login form')
    await user.click(editButton)

    expect(onEditTask).toHaveBeenCalledWith('task-1')
  })

  it('should call onAddTask when add task button is clicked', async () => {
    const user = userEvent.setup()
    const onAddTask = vi.fn()
    render(<EpicDetail {...defaultProps} onAddTask={onAddTask} />)

    const addButton = screen.getByText('+ Add task')
    await user.click(addButton)

    expect(onAddTask).toHaveBeenCalled()
  })

  it('should display queue readiness info correctly', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('0 tasks ready to queue')).toBeInTheDocument()
    expect(screen.getByText('1 needs specs')).toBeInTheDocument()
  })

  it('should show plural forms in queue info', () => {
    const allWithSpecs: SprintTask[] = mockTasks.map((t) => ({
      ...t,
      spec: 'has spec',
      status: 'backlog' as const
    }))
    render(<EpicDetail {...defaultProps} tasks={allWithSpecs} />)

    expect(screen.getByText('3 tasks ready to queue')).toBeInTheDocument()
  })

  it('should disable queue button when tasks need specs', () => {
    render(<EpicDetail {...defaultProps} />)

    const queueButton = screen.getByText('Send to Pipeline')
    expect(queueButton).toBeDisabled()
  })

  it('should enable queue button when all backlog tasks have specs', () => {
    const tasksWithSpecs = mockTasks.filter((t) => t.status !== 'backlog' || t.spec)
    render(<EpicDetail {...defaultProps} tasks={tasksWithSpecs} />)

    const queueButton = screen.getByText('Send to Pipeline')
    expect(queueButton).not.toBeDisabled()
  })

  it('should call onQueueAll when queue button is clicked', async () => {
    const user = userEvent.setup()
    const onQueueAll = vi.fn()
    const tasksWithSpecs = mockTasks.filter((t) => t.status !== 'backlog' || t.spec)
    render(<EpicDetail {...defaultProps} tasks={tasksWithSpecs} onQueueAll={onQueueAll} />)

    const queueButton = screen.getByText('Send to Pipeline')
    await user.click(queueButton)

    expect(onQueueAll).toHaveBeenCalled()
  })

  it('should calculate progress percentage correctly', () => {
    render(<EpicDetail {...defaultProps} />)

    // 1 done out of 3 tasks = 33%
    const progressBar = document.querySelector('.epic-detail__progress-bar-fill')
    expect(progressBar).toHaveStyle({ width: '33%' })
  })

  it('should handle empty task list', () => {
    render(<EpicDetail {...defaultProps} tasks={[]} />)

    expect(screen.getByText('0 done')).toBeInTheDocument()
    expect(screen.getByText('0 active')).toBeInTheDocument()
    expect(screen.queryByText(/missing specs/)).not.toBeInTheDocument()
  })

  it('should handle group without goal', () => {
    const groupWithoutGoal = { ...mockGroup, goal: null }
    render(<EpicDetail {...defaultProps} group={groupWithoutGoal} />)

    expect(screen.queryByText('Implement secure user authentication')).not.toBeInTheDocument()
  })

  it('should display status badges for all tasks', () => {
    render(<EpicDetail {...defaultProps} />)

    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Backlog')).toBeInTheDocument()
  })

  it('should handle tasks with null spec as missing specs', () => {
    const tasksWithNull: SprintTask[] = [
      {
        ...mockTasks[0],
        id: 'task-null',
        status: 'backlog',
        spec: null
      }
    ]

    render(<EpicDetail {...defaultProps} tasks={tasksWithNull} />)

    expect(screen.getByText('1 task missing specs')).toBeInTheDocument()
    expect(screen.getByText('no spec')).toBeInTheDocument()
  })

  it('should handle tasks with whitespace-only spec as missing specs', () => {
    const tasksWithWhitespace: SprintTask[] = [
      {
        ...mockTasks[0],
        id: 'task-whitespace',
        status: 'backlog',
        spec: '   '
      }
    ]

    render(<EpicDetail {...defaultProps} tasks={tasksWithWhitespace} />)

    expect(screen.getByText('1 task missing specs')).toBeInTheDocument()
    expect(screen.getByText('no spec')).toBeInTheDocument()
  })
})
