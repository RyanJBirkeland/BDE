import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false
  })
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } }
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn()
}))

const mockToggleTaskSelection = vi.fn()
const mockSelectRange = vi.fn()
const mockClearSelection = vi.fn()
let mockSelectedTaskIds: string[] = []

vi.mock('../../../stores/sprintUI', () => ({
  useSprintUI: (selector?: (state: any) => any) => {
    const state = {
      selectedTaskIds: mockSelectedTaskIds,
      toggleTaskSelection: mockToggleTaskSelection,
      selectRange: mockSelectRange,
      clearSelection: mockClearSelection
    }
    return selector ? selector(state) : state
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

import { TaskCard } from '../TaskCard'
import { useSprintTasks } from '../../../stores/sprintTasks'

let mockTasksData: SprintTask[] = []

describe('TaskCard', () => {
  const defaultProps = {
    index: 0,
    prMerged: false,
    onPushToSprint: vi.fn(),
    onLaunch: vi.fn(),
    onViewSpec: vi.fn(),
    onViewOutput: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTasksData = []
    mockSelectedTaskIds = []

    // Set up the Zustand store mock
    vi.mocked(useSprintTasks).mockImplementation((selector?: (state: any) => unknown) => {
      if (typeof selector === 'function') {
        return selector({ tasks: mockTasksData })
      }
      return { tasks: mockTasksData } as never
    })
  })

  it('renders task title and repo badge', () => {
    const task = makeTask({ title: 'Fix the bug', repo: 'BDE' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('BDE')).toBeInTheDocument()
  })

  it('shows spec indicator when task has a spec', () => {
    const task = makeTask({ spec: '## Some spec' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByTitle('Has spec')).toBeInTheDocument()
  })

  it('does not show spec indicator when task has no spec', () => {
    const task = makeTask({ spec: null })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.queryByTitle('Has spec')).not.toBeInTheDocument()
  })

  it('shows PR Merged badge when prMerged is true', () => {
    const task = makeTask({ pr_url: 'https://github.com/org/repo/pull/1' })
    render(<TaskCard {...defaultProps} task={task} prMerged={true} />)

    expect(screen.getByText('Merged')).toBeInTheDocument()
  })

  it('shows PR Open badge when pr_url exists but not merged', () => {
    const task = makeTask({ pr_url: 'https://github.com/org/repo/pull/1' })
    render(<TaskCard {...defaultProps} task={task} prMerged={false} />)

    expect(screen.getByText('PR Open')).toBeInTheDocument()
  })

  // Status-specific action buttons

  it('backlog task shows "→ Sprint" and "Spec" buttons', () => {
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: '→ Sprint' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spec' })).toBeInTheDocument()
  })

  it('queued task shows "Launch" and "Spec" buttons', () => {
    const task = makeTask({ status: 'queued' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'Launch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spec' })).toBeInTheDocument()
  })

  it('active task shows "View Output" button', () => {
    const task = makeTask({ status: 'active', started_at: new Date().toISOString() })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'View Output' })).toBeInTheDocument()
  })

  it('done task shows "View Output" button', () => {
    const task = makeTask({ status: 'done' })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'View Output' })).toBeInTheDocument()
  })

  it('done task with PR shows PR number button', () => {
    const task = makeTask({ status: 'done', pr_url: 'https://github.com/pr/42', pr_number: 42 })
    render(<TaskCard {...defaultProps} task={task} />)

    expect(screen.getByRole('button', { name: 'PR #42' })).toBeInTheDocument()
  })

  // Callback tests

  it('clicking "→ Sprint" calls onPushToSprint', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: '→ Sprint' }))
    expect(defaultProps.onPushToSprint).toHaveBeenCalledWith(task)
  })

  it('clicking "Launch" calls onLaunch', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'queued' })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Launch' }))
    expect(defaultProps.onLaunch).toHaveBeenCalledWith(task)
  })

  it('clicking "View Output" calls onViewOutput', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'active', started_at: new Date().toISOString() })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'View Output' }))
    expect(defaultProps.onViewOutput).toHaveBeenCalledWith(task)
  })

  it('clicking "Spec" calls onViewSpec', async () => {
    const user = userEvent.setup()
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} />)

    await user.click(screen.getByRole('button', { name: 'Spec' }))
    expect(defaultProps.onViewSpec).toHaveBeenCalledWith(task)
  })

  // Repo badge variants

  it('renders info badge for BDE repo', () => {
    const task = makeTask({ repo: 'BDE' })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.bde-badge--info')).toBeInTheDocument()
  })

  it('renders warning badge for feast repo', () => {
    const task = makeTask({ repo: 'feast' })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.bde-badge--warning')).toBeInTheDocument()
  })

  it('renders success badge for life-os repo', () => {
    const task = makeTask({ repo: 'life-os' })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.bde-badge--success')).toBeInTheDocument()
  })

  // Priority badge tests
  it('shows P1 badge with danger variant for priority 1 task', () => {
    const task = makeTask({ priority: 1 })
    render(<TaskCard {...defaultProps} task={task} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
  })

  it('shows P2 badge with warning variant for priority 2 task', () => {
    const task = makeTask({ priority: 2 })
    render(<TaskCard {...defaultProps} task={task} />)
    expect(screen.getByText('P2')).toBeInTheDocument()
  })

  it('does not show priority badge for priority 3 task', () => {
    const task = makeTask({ priority: 3 })
    render(<TaskCard {...defaultProps} task={task} />)
    expect(screen.queryByText('P3')).not.toBeInTheDocument()
  })

  // Conflict detection
  it('shows Conflict badge when pr_mergeable_state is dirty and not merged', () => {
    const task = makeTask({
      pr_url: 'https://github.com/org/repo/pull/1',
      pr_mergeable_state: 'dirty'
    })
    render(<TaskCard {...defaultProps} task={task} prMerged={false} />)
    expect(screen.getByText('Conflict')).toBeInTheDocument()
  })

  it('does not show Conflict badge when pr is merged', () => {
    const task = makeTask({
      pr_url: 'https://github.com/org/repo/pull/1',
      pr_mergeable_state: 'dirty'
    })
    render(<TaskCard {...defaultProps} task={task} prMerged={true} />)
    expect(screen.queryByText('Conflict')).not.toBeInTheDocument()
  })

  // Blocked status
  it('shows Blocked badge for blocked task', () => {
    const task = makeTask({ status: 'blocked' })
    render(<TaskCard {...defaultProps} task={task} />)
    expect(screen.getByText('Blocked')).toBeInTheDocument()
  })

  it('blocked task has task-card--blocked class', () => {
    const task = makeTask({ status: 'blocked' })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.task-card--blocked')).toBeInTheDocument()
  })

  // Blocker labels
  it('shows "Blocked by" label when task is blocked and has dependencies', () => {
    const blockerId = crypto.randomUUID()
    const blockerTask = makeTask({ id: blockerId, title: 'Setup authentication' })
    const blockedTask = makeTask({
      status: 'blocked',
      depends_on: [{ id: blockerId, type: 'hard' }]
    })

    mockTasksData = [blockerTask, blockedTask]
    render(<TaskCard {...defaultProps} task={blockedTask} />)
    expect(screen.getByText(/Blocked by:/)).toBeInTheDocument()
    expect(screen.getByText(/Setup authentication/)).toBeInTheDocument()
  })

  it('shows multiple blockers when task has multiple hard dependencies', () => {
    const blocker1Id = crypto.randomUUID()
    const blocker2Id = crypto.randomUUID()
    const blocker1 = makeTask({ id: blocker1Id, title: 'Task A' })
    const blocker2 = makeTask({ id: blocker2Id, title: 'Task B' })
    const blockedTask = makeTask({
      status: 'blocked',
      depends_on: [
        { id: blocker1Id, type: 'hard' },
        { id: blocker2Id, type: 'hard' }
      ]
    })

    mockTasksData = [blocker1, blocker2, blockedTask]
    render(<TaskCard {...defaultProps} task={blockedTask} />)
    expect(screen.getByText(/Task A/)).toBeInTheDocument()
    expect(screen.getByText(/Task B/)).toBeInTheDocument()
  })

  it('does not show blocker label when task is blocked but has no dependencies', () => {
    const task = makeTask({ status: 'blocked', depends_on: null })
    render(<TaskCard {...defaultProps} task={task} />)
    expect(screen.queryByText(/Blocked by:/)).not.toBeInTheDocument()
  })

  it('does not show blocker label when task is not blocked', () => {
    const blockerId = crypto.randomUUID()
    const task = makeTask({
      status: 'queued',
      depends_on: [{ id: blockerId, type: 'hard' }]
    })
    render(<TaskCard {...defaultProps} task={task} />)
    expect(screen.queryByText(/Blocked by:/)).not.toBeInTheDocument()
  })

  // Dependency chips
  it('renders dependency chips when task has depends_on', () => {
    const task = makeTask({
      depends_on: [
        { id: 'abcdef123456', type: 'hard' },
        { id: 'fedcba654321', type: 'soft' }
      ]
    })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    // Hard dep chip has --hard modifier
    expect(container.querySelector('.task-card__dep-chip--hard')).toBeInTheDocument()
    expect(
      container.querySelector('.task-card__dep-chip:not(.task-card__dep-chip--hard)')
    ).toBeInTheDocument()
  })

  it('does not render dependency chips when depends_on is null', () => {
    const task = makeTask({ depends_on: null })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.task-card__deps')).not.toBeInTheDocument()
  })

  // isGenerating badge
  it('shows Writing spec... badge when isGenerating is true', () => {
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} isGenerating={true} />)
    expect(screen.getByText('Writing spec...')).toBeInTheDocument()
  })

  it('does not show Writing spec... when isGenerating is false', () => {
    const task = makeTask({ status: 'backlog' })
    render(<TaskCard {...defaultProps} task={task} isGenerating={false} />)
    expect(screen.queryByText('Writing spec...')).not.toBeInTheDocument()
  })

  // onMarkDone and onStop callbacks
  it('queued task with onMarkDone shows Done button', () => {
    const task = makeTask({ status: 'queued' })
    const onMarkDone = vi.fn()
    render(<TaskCard {...defaultProps} task={task} onMarkDone={onMarkDone} />)
    expect(screen.getByRole('button', { name: '✓ Done' })).toBeInTheDocument()
  })

  it('active task with onStop shows Stop button', () => {
    const task = makeTask({ status: 'active', started_at: new Date().toISOString() })
    const onStop = vi.fn()
    render(<TaskCard {...defaultProps} task={task} onStop={onStop} />)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('clicking Stop calls onStop with task', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const task = makeTask({ status: 'active', started_at: new Date().toISOString() })
    render(<TaskCard {...defaultProps} task={task} onStop={onStop} />)
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledWith(task)
  })

  it('clicking Done in queued state calls onMarkDone with task', async () => {
    const user = userEvent.setup()
    const onMarkDone = vi.fn()
    const task = makeTask({ status: 'queued' })
    render(<TaskCard {...defaultProps} task={task} onMarkDone={onMarkDone} />)
    await user.click(screen.getByRole('button', { name: '✓ Done' }))
    expect(onMarkDone).toHaveBeenCalledWith(task)
  })

  it('high priority task has task-card--high-priority class', () => {
    const task = makeTask({ priority: 1 })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.task-card--high-priority')).toBeInTheDocument()
  })

  it('normal priority task does not have task-card--high-priority class', () => {
    const task = makeTask({ priority: 5 })
    const { container } = render(<TaskCard {...defaultProps} task={task} />)
    expect(container.querySelector('.task-card--high-priority')).not.toBeInTheDocument()
  })

  describe('bulk selection', () => {
    it('shows checkbox when any task is selected', () => {
      mockSelectedTaskIds = ['other-task']
      render(<TaskCard {...defaultProps} task={makeTask()} />)
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
    })

    it('hides checkbox when no tasks selected', () => {
      mockSelectedTaskIds = []
      render(<TaskCard {...defaultProps} task={makeTask()} />)
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('calls toggleTaskSelection on checkbox click', async () => {
      mockSelectedTaskIds = ['other-task']
      const user = userEvent.setup()
      const task = makeTask()
      render(<TaskCard {...defaultProps} task={task} />)
      await user.click(screen.getByRole('checkbox'))
      expect(mockToggleTaskSelection).toHaveBeenCalledWith(task.id)
    })
  })
})
