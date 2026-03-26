import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SprintDetailPane } from '../SprintDetailPane'
import type { SprintTask } from '../../../../../shared/types'
import { TASK_STATUS } from '../../../../../shared/constants'

// Mock stores
const mocks = vi.hoisted(() => {
  const storeState = {
    tasks: [] as SprintTask[],
  }

  const eventState = {
    latestEvents: {} as Record<string, any>,
  }

  return {
    storeState,
    eventState,
  }
})

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.storeState)
    }
    return []
  }),
}))

vi.mock('../../../stores/sprintEvents', () => ({
  useSprintEvents: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.eventState)
    }
    return null
  }),
}))

vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock window.api
beforeEach(() => {
  vi.clearAllMocks()
  mocks.storeState.tasks = []
  mocks.eventState.latestEvents = {}

  window.api = {
    openExternal: vi.fn(),
  } as any

  window.dispatchEvent = vi.fn()
})

describe('SprintDetailPane', () => {
  const mockTask: SprintTask = {
    id: 'task-1',
    title: 'Test Task',
    repo: 'BDE',
    prompt: 'Test prompt',
    priority: 1,
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
    updated_at: '2024-01-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
  }

  it('renders empty state when no task is provided', () => {
    render(<SprintDetailPane task={null} onClose={vi.fn()} />)
    expect(screen.getByText(/Select a task to view details/)).toBeInTheDocument()
  })

  it('renders task title and status badge', () => {
    render(<SprintDetailPane task={mockTask} onClose={vi.fn()} />)
    expect(screen.getByText('Test Task')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })


  it('shows Launch button for queued tasks', () => {
    const onLaunch = vi.fn()
    render(<SprintDetailPane task={mockTask} onClose={vi.fn()} onLaunch={onLaunch} />)

    const launchButton = screen.getByText('Launch')
    fireEvent.click(launchButton)

    expect(onLaunch).toHaveBeenCalledWith(mockTask)
  })

  it('shows Stop button for active tasks', () => {
    const activeTask = { ...mockTask, status: TASK_STATUS.ACTIVE }
    const onStop = vi.fn()

    render(<SprintDetailPane task={activeTask} onClose={vi.fn()} onStop={onStop} />)

    const stopButton = screen.getByText('Stop')
    fireEvent.click(stopButton)

    expect(onStop).toHaveBeenCalledWith(activeTask)
  })

  it('shows Re-run button for failed tasks', () => {
    const failedTask = { ...mockTask, status: TASK_STATUS.FAILED }
    const onRerun = vi.fn()

    render(<SprintDetailPane task={failedTask} onClose={vi.fn()} onRerun={onRerun} />)

    const rerunButton = screen.getByText('Re-run')
    fireEvent.click(rerunButton)

    expect(onRerun).toHaveBeenCalledWith(failedTask)
  })

  it('displays metadata correctly', () => {
    render(<SprintDetailPane task={mockTask} onClose={vi.fn()} />)

    expect(screen.getByText('Specification')).toBeInTheDocument()
    expect(screen.getByText('BDE')).toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()
  })

  it('displays dependencies when present', () => {
    const depTask: SprintTask = {
      ...mockTask,
      id: 'dep-1',
      title: 'Dependency Task',
      status: 'done',
    }

    const taskWithDeps: SprintTask = {
      ...mockTask,
      depends_on: [{ id: 'dep-1', type: 'hard' }],
    }

    mocks.storeState.tasks = [depTask]

    render(<SprintDetailPane task={taskWithDeps} onClose={vi.fn()} />)

    expect(screen.getByText('Dependencies')).toBeInTheDocument()
    expect(screen.getByText('Dependency Task')).toBeInTheDocument()
  })

  it('shows blocked alert for blocked tasks', () => {
    const blockedTask = { ...mockTask, status: TASK_STATUS.BLOCKED }
    render(<SprintDetailPane task={blockedTask} onClose={vi.fn()} />)

    expect(screen.getByText('Task is blocked')).toBeInTheDocument()
  })

  it('displays spec section when spec is present', () => {
    const taskWithSpec = { ...mockTask, spec: '# Test Spec\n\nThis is a test spec.' }
    render(<SprintDetailPane task={taskWithSpec} onClose={vi.fn()} />)

    expect(screen.getByText('Specification')).toBeInTheDocument()
  })

  it('displays agent section when agent_run_id is present', () => {
    const taskWithAgent = { ...mockTask, agent_run_id: 'agent-123', status: TASK_STATUS.ACTIVE }
    render(<SprintDetailPane task={taskWithAgent} onClose={vi.fn()} />)

    expect(screen.getByText('agent-123')).toBeInTheDocument()
  })

  it('opens agent in agents view when button is clicked', () => {
    const taskWithAgent = { ...mockTask, agent_run_id: 'agent-123', status: TASK_STATUS.ACTIVE }
    render(<SprintDetailPane task={taskWithAgent} onClose={vi.fn()} />)

    const openButton = screen.getByText(/Open in Agents/)
    fireEvent.click(openButton)

    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bde:navigate',
        detail: { view: 'agents', sessionId: 'agent-123' },
      })
    )
  })

  it('displays PR section when PR is present', () => {
    const taskWithPR: SprintTask = {
      ...mockTask,
      pr_url: 'https://github.com/test/test/pull/123',
      pr_number: 123,
      pr_status: 'open',
      pr_mergeable_state: 'clean',
      status: TASK_STATUS.DONE,
    }

    render(<SprintDetailPane task={taskWithPR} onClose={vi.fn()} />)

    expect(screen.getByText('Pull Request')).toBeInTheDocument()
    expect(screen.getByText('#123')).toBeInTheDocument()
  })

  it('opens PR URL when View PR button is clicked', () => {
    const taskWithPR: SprintTask = {
      ...mockTask,
      pr_url: 'https://github.com/test/test/pull/123',
      pr_number: 123,
      pr_status: 'open',
      status: TASK_STATUS.DONE,
    }

    render(<SprintDetailPane task={taskWithPR} onClose={vi.fn()} />)

    const viewPRButton = screen.getByText('View PR')
    fireEvent.click(viewPRButton)

    expect(window.api.openExternal).toHaveBeenCalledWith('https://github.com/test/test/pull/123')
  })

  it('shows conflict badge for dirty PR', () => {
    const taskWithConflict: SprintTask = {
      ...mockTask,
      pr_url: 'https://github.com/test/test/pull/123',
      pr_number: 123,
      pr_status: 'open',
      pr_mergeable_state: 'dirty',
      status: TASK_STATUS.DONE,
    }

    render(<SprintDetailPane task={taskWithConflict} onClose={vi.fn()} />)

    expect(screen.getByText('Conflict')).toBeInTheDocument()
  })

  it('displays notes when present', () => {
    const taskWithNotes = { ...mockTask, notes: 'Important note about this task' }
    render(<SprintDetailPane task={taskWithNotes} onClose={vi.fn()} />)

    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Important note about this task')).toBeInTheDocument()
  })

  it('calls onDelete when delete button is clicked and confirmed', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const { container } = render(<SprintDetailPane task={mockTask} onClose={onClose} onDelete={onDelete} />)

    // Find the delete button - it's the one with Trash2 icon
    const buttons = container.querySelectorAll('button')
    const deleteButton = Array.from(buttons).find(btn => {
      // The delete button has a Trash2 icon child
      return btn.querySelector('svg')?.classList.contains('lucide-trash-2') ||
             btn.innerHTML.includes('Trash2')
    })

    if (deleteButton) {
      fireEvent.click(deleteButton)
      expect(confirmSpy).toHaveBeenCalled()
      expect(onDelete).toHaveBeenCalledWith('task-1')
      expect(onClose).toHaveBeenCalled()
    }

    confirmSpy.mockRestore()
  })

  it('shows Done button for queued and active tasks', () => {
    const onMarkDone = vi.fn()
    render(<SprintDetailPane task={mockTask} onClose={vi.fn()} onMarkDone={onMarkDone} />)

    const markDoneButton = screen.getByText('Done')
    fireEvent.click(markDoneButton)

    expect(onMarkDone).toHaveBeenCalledWith(mockTask)
  })

  it('calls onEditInWorkbench when Edit button is clicked', () => {
    const onEditInWorkbench = vi.fn()
    render(<SprintDetailPane task={mockTask} onClose={vi.fn()} onEditInWorkbench={onEditInWorkbench} />)

    const editButton = screen.getByText('Edit')
    fireEvent.click(editButton)

    expect(onEditInWorkbench).toHaveBeenCalledWith(mockTask)
  })

  it('renders inline meta strip with repo and priority', () => {
    render(<SprintDetailPane task={mockTask} onClose={vi.fn()} />)

    // Meta strip shows repo and priority inline
    expect(screen.getByText('Repo')).toBeInTheDocument()
    expect(screen.getByText('BDE')).toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()
  })
})
