import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'

// Capture DndContext's onDragEnd so we can invoke it manually
let capturedOnDragEnd: ((event: unknown) => void) | null = null

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode
    onDragEnd: (e: unknown) => void
  }) => {
    capturedOnDragEnd = onDragEnd
    return <div data-testid="dnd-context">{children}</div>
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) =>
    children ? <div data-testid="drag-overlay">{children}</div> : null,
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
  arrayMove: vi.fn(
    <T,>(arr: T[], from: number, to: number): T[] => {
      const copy = [...arr]
      const [item] = copy.splice(from, 1)
      copy.splice(to, 0, item)
      return copy
    }
  ),
  sortableKeyboardCoordinates: vi.fn(),
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
    template_name: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

// Import after mocks are set up
import { KanbanBoard } from '../KanbanBoard'

describe('KanbanBoard', () => {
  const defaultProps = {
    todoTasks: [] as SprintTask[],
    activeTasks: [] as SprintTask[],
    awaitingReviewTasks: [] as SprintTask[],
    prMergedMap: {} as Record<string, boolean>,
    onDragEnd: vi.fn(),
    onReorder: vi.fn(),
    onPushToSprint: vi.fn(),
    onLaunch: vi.fn(),
    onViewSpec: vi.fn(),
    onViewOutput: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnDragEnd = null
  })

  it('renders 3 columns (To Do, In Progress, Awaiting Review)', () => {
    render(<KanbanBoard {...defaultProps} />)
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Awaiting Review')).toBeInTheDocument()
  })

  it('does not render Backlog or Done columns', () => {
    render(<KanbanBoard {...defaultProps} />)
    expect(screen.queryByText('Backlog')).not.toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('distributes tasks to correct columns', () => {
    const props = {
      ...defaultProps,
      todoTasks: [makeTask({ title: 'Queued item', status: 'queued' })],
      activeTasks: [makeTask({ title: 'Active item', status: 'active' })],
      awaitingReviewTasks: [makeTask({ title: 'Review item', status: 'done', pr_status: 'open' })],
    }

    render(<KanbanBoard {...props} />)

    expect(screen.getByText('Queued item')).toBeInTheDocument()
    expect(screen.getByText('Active item')).toBeInTheDocument()
    expect(screen.getByText('Review item')).toBeInTheDocument()
  })

  it('renders empty columns with empty-state message', () => {
    render(<KanbanBoard {...defaultProps} />)
    expect(screen.getByText('Sprint queue is empty')).toBeInTheDocument()
    expect(screen.getByText('Nothing in progress')).toBeInTheDocument()
    expect(screen.getByText('No PRs awaiting review')).toBeInTheDocument()
  })

  it('shows correct task count per column', () => {
    const props = {
      ...defaultProps,
      todoTasks: [
        makeTask({ title: 'T1', status: 'queued' }),
        makeTask({ title: 'T2', status: 'queued' }),
      ],
      awaitingReviewTasks: [
        makeTask({ title: 'R1', status: 'done', pr_status: 'open' }),
      ],
    }

    render(<KanbanBoard {...props} />)

    // Todo and Review show plain counts; In Progress shows WIP badge (0/5)
    const badges = screen.getAllByText(/^\d+(\/\d+)?$/)
    const badgeValues = badges.map((el) => el.textContent)
    expect(badgeValues).toContain('2') // todo
    expect(badgeValues).toContain('1') // review
    expect(badgeValues).toContain('0/5') // in progress WIP badge
  })

  it('calls onDragEnd when task is dragged to another column', () => {
    const task = makeTask({ id: 'task-1', title: 'Drag me', status: 'queued' })
    render(<KanbanBoard {...defaultProps} todoTasks={[task]} />)

    capturedOnDragEnd?.({
      active: { id: 'task-1' },
      over: { id: 'active' },
    })

    expect(defaultProps.onDragEnd).toHaveBeenCalledWith('task-1', 'active')
  })

  it('does not call onDragEnd when dropped on same column status', () => {
    const task = makeTask({ id: 'task-1', status: 'queued' })
    render(<KanbanBoard {...defaultProps} todoTasks={[task]} />)

    capturedOnDragEnd?.({
      active: { id: 'task-1' },
      over: { id: 'queued' },
    })

    expect(defaultProps.onDragEnd).not.toHaveBeenCalled()
  })

  it('does not call onDragEnd when dropped on nothing', () => {
    const task = makeTask({ id: 'task-1', status: 'queued' })
    render(<KanbanBoard {...defaultProps} todoTasks={[task]} />)

    capturedOnDragEnd?.({
      active: { id: 'task-1' },
      over: null,
    })

    expect(defaultProps.onDragEnd).not.toHaveBeenCalled()
  })

  it('shows confirm modal when dragging active task back to queued', () => {
    const task = makeTask({ id: 'task-active', status: 'active' })
    render(<KanbanBoard {...defaultProps} activeTasks={[task]} />)

    act(() => {
      capturedOnDragEnd?.({
        active: { id: 'task-active' },
        over: { id: 'queued' },
      })
    })

    // ConfirmModal should be shown — onDragEnd not called yet
    expect(screen.getByText(/Move back to queue/)).toBeInTheDocument()
    expect(defaultProps.onDragEnd).not.toHaveBeenCalled()
  })

  it('cancels active→queued drag when user dismisses confirm modal', () => {
    const task = makeTask({ id: 'task-active', status: 'active' })
    render(<KanbanBoard {...defaultProps} activeTasks={[task]} />)

    act(() => {
      capturedOnDragEnd?.({
        active: { id: 'task-active' },
        over: { id: 'queued' },
      })
    })

    // Click Cancel
    act(() => {
      screen.getByRole('button', { name: 'Cancel' }).click()
    })

    expect(defaultProps.onDragEnd).not.toHaveBeenCalled()
  })

  it('allows active→queued drag when user confirms via modal', () => {
    const task = makeTask({ id: 'task-active', status: 'active' })
    render(<KanbanBoard {...defaultProps} activeTasks={[task]} />)

    act(() => {
      capturedOnDragEnd?.({
        active: { id: 'task-active' },
        over: { id: 'queued' },
      })
    })

    // Click confirm button
    act(() => {
      screen.getByRole('button', { name: 'Move to Queue' }).click()
    })

    expect(defaultProps.onDragEnd).toHaveBeenCalledWith('task-active', 'queued')
  })

  it('does not allow drops into review column', () => {
    const task = makeTask({ id: 'task-1', status: 'queued' })
    render(<KanbanBoard {...defaultProps} todoTasks={[task]} />)

    capturedOnDragEnd?.({
      active: { id: 'task-1' },
      over: { id: 'review' },
    })

    expect(defaultProps.onDragEnd).not.toHaveBeenCalled()
  })

  it('blocks drops into active column when WIP limit is reached (5 active tasks)', () => {
    const activeTasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `active-${i}`, title: `Active ${i}`, status: 'active' })
    )
    const todoTask = makeTask({ id: 'queued-1', title: 'Queued', status: 'queued' })

    render(
      <KanbanBoard
        {...defaultProps}
        todoTasks={[todoTask]}
        activeTasks={activeTasks}
      />
    )

    capturedOnDragEnd?.({
      active: { id: 'queued-1' },
      over: { id: 'active' },
    })

    expect(defaultProps.onDragEnd).not.toHaveBeenCalled()
  })

  it('allows drops into active column when under WIP limit', () => {
    const activeTasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ id: `active-${i}`, title: `Active ${i}`, status: 'active' })
    )
    const todoTask = makeTask({ id: 'queued-1', title: 'Queued', status: 'queued' })

    render(
      <KanbanBoard
        {...defaultProps}
        todoTasks={[todoTask]}
        activeTasks={activeTasks}
      />
    )

    capturedOnDragEnd?.({
      active: { id: 'queued-1' },
      over: { id: 'active' },
    })

    expect(defaultProps.onDragEnd).toHaveBeenCalledWith('queued-1', 'active')
  })

  it('shows WIP count badge in In Progress column header', () => {
    const activeTasks = Array.from({ length: 3 }, (_, i) =>
      makeTask({ id: `active-${i}`, title: `Active ${i}`, status: 'active' })
    )

    render(<KanbanBoard {...defaultProps} activeTasks={activeTasks} />)

    expect(screen.getByText('3/5')).toBeInTheDocument()
  })
})
