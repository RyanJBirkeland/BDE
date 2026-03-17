import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    pr_url: null,
    started_at: null,
    completed_at: null,
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

    const counts = screen.getAllByText(/^[0-3]$/)
    const countValues = counts.map((el) => el.textContent)
    expect(countValues).toContain('2') // todo
    expect(countValues).toContain('1') // review
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

  it('does not allow drops into review column', () => {
    const task = makeTask({ id: 'task-1', status: 'queued' })
    render(<KanbanBoard {...defaultProps} todoTasks={[task]} />)

    capturedOnDragEnd?.({
      active: { id: 'task-1' },
      over: { id: 'review' },
    })

    expect(defaultProps.onDragEnd).not.toHaveBeenCalled()
  })
})
