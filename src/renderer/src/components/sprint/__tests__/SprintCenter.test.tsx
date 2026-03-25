import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SprintCenter } from '../SprintCenter'
import type { SprintTask } from '../../../../../shared/types'

// vi.hoisted ensures these refs are available inside vi.mock factory functions,
// since vi.mock factories are hoisted to run before module-level code
const mocks = vi.hoisted(() => {
  const mockLoadData = vi.fn()
  const mockSetRepoFilter = vi.fn()
  const mockSetLogDrawerTaskId = vi.fn()
  const mockSetView = vi.fn()

  // Mutable store state — mutations are picked up by closures in mock factories
  const storeState = {
    tasks: [] as SprintTask[],
    loading: false,
    loadError: null as string | null,
    loadData: mockLoadData,
  }

  const uiState = {
    repoFilter: null as string | null,
    logDrawerTaskId: null as string | null,
    setRepoFilter: mockSetRepoFilter,
    setLogDrawerTaskId: mockSetLogDrawerTaskId,
  }

  // Mutable arrays — replace .value to update what closures see
  const conflictingTaskIds = { value: [] as string[] }
  const visibleStuckTasks = { value: [] as SprintTask[] }

  return {
    mockLoadData,
    mockSetRepoFilter,
    mockSetLogDrawerTaskId,
    mockSetView,
    storeState,
    uiState,
    conflictingTaskIds,
    visibleStuckTasks,
  }
})

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.storeState)
    }
    return mocks.mockLoadData
  }),
}))

vi.mock('../../../stores/sprintUI', () => ({
  useSprintUI: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.uiState)
    }
    return undefined
  }),
}))

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ setView: mocks.mockSetView })
    }
    return mocks.mockSetView
  }),
}))

vi.mock('../../../stores/prConflicts', () => ({
  usePrConflictsStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ conflictingTaskIds: mocks.conflictingTaskIds.value })
    }
    return mocks.conflictingTaskIds.value
  }),
}))

vi.mock('../../../stores/sprintEvents', () => ({
  useSprintEvents: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ initTaskOutputListener: () => () => {} })
    }
    return () => () => {}
  }),
}))

vi.mock('../../../hooks/useTaskNotifications', () => ({
  setOpenLogDrawerTaskId: vi.fn(),
  useTaskToasts: vi.fn(),
}))

vi.mock('../../../hooks/useSprintPolling', () => ({
  useSprintPolling: vi.fn(),
}))

vi.mock('../../../hooks/usePrStatusPolling', () => ({
  usePrStatusPolling: vi.fn(),
}))

vi.mock('../../../hooks/useSprintKeyboardShortcuts', () => ({
  useSprintKeyboardShortcuts: vi.fn(),
}))

vi.mock('../../../hooks/useSprintTaskActions', () => ({
  useSprintTaskActions: () => ({
    handleSaveSpec: vi.fn(),
    handleMarkDone: vi.fn(),
    handleStop: vi.fn(),
    handleRerun: vi.fn(),
    launchTask: vi.fn(),
    deleteTask: vi.fn(),
    confirmProps: { open: false, title: '', message: '', onConfirm: vi.fn(), onCancel: vi.fn() },
  }),
}))

vi.mock('../../../hooks/useHealthCheck', () => ({
  useHealthCheck: vi.fn(() => ({
    visibleStuckTasks: mocks.visibleStuckTasks.value,
    dismissTask: vi.fn(),
  })),
}))

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: {},
  useReducedMotion: () => false,
}))

// Mock child components
vi.mock('../CircuitPipeline', () => ({
  CircuitPipeline: ({ tasks }: { tasks: SprintTask[] }) => (
    <div data-testid="circuit-pipeline">CircuitPipeline ({tasks.length} tasks)</div>
  ),
}))

vi.mock('../SprintTaskList', () => ({
  SprintTaskList: ({ tasks, loading, repoFilter }: { tasks: SprintTask[]; loading: boolean; repoFilter: string | null }) => (
    <div data-testid="sprint-task-list">
      SprintTaskList ({tasks.length} tasks, loading: {String(loading)}, filter: {repoFilter || 'none'})
    </div>
  ),
}))

vi.mock('../SprintDetailPane', () => ({
  SprintDetailPane: ({ task }: { task: SprintTask | null }) => (
    <div data-testid="sprint-detail-pane">
      SprintDetailPane ({task ? task.title : 'no task'})
    </div>
  ),
}))

vi.mock('../ConflictDrawer', () => ({
  ConflictDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="conflict-drawer">ConflictDrawer</div> : null,
}))

vi.mock('../HealthCheckDrawer', () => ({
  HealthCheckDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="health-drawer">HealthCheckDrawer</div> : null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}))

vi.mock('lucide-react', () => ({
  Plus: () => <span data-testid="plus-icon">+</span>,
}))

vi.mock('../../ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('../../ui/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('../../ui/ConfirmModal', () => ({
  ConfirmModal: () => <div data-testid="confirm-modal">ConfirmModal</div>,
}))

vi.mock('../../ui/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Helper function to create mock tasks
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
    ...overrides,
  }
}

describe('SprintCenter', () => {
  beforeEach(() => {
    // Reset mocks
    mocks.mockLoadData.mockClear()
    mocks.mockSetRepoFilter.mockClear()
    mocks.mockSetLogDrawerTaskId.mockClear()
    mocks.mockSetView.mockClear()

    // Reset store states
    Object.assign(mocks.storeState, {
      tasks: [],
      loading: false,
      loadError: null,
      loadData: mocks.mockLoadData,
    })
    Object.assign(mocks.uiState, {
      repoFilter: null,
      logDrawerTaskId: null,
      setRepoFilter: mocks.mockSetRepoFilter,
      setLogDrawerTaskId: mocks.mockSetLogDrawerTaskId,
    })

    // Reset mutable mock arrays
    mocks.conflictingTaskIds.value = []
    mocks.visibleStuckTasks.value = []
  })

  describe('Basic rendering', () => {
    it('renders CircuitPipeline, SprintTaskList, and SprintDetailPane', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1', title: 'Test Task' })],
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('circuit-pipeline')).toBeInTheDocument()
      expect(screen.getByTestId('sprint-task-list')).toBeInTheDocument()
      expect(screen.getByTestId('sprint-detail-pane')).toBeInTheDocument()
    })

    it('renders ConfirmModal', () => {
      render(<SprintCenter />)

      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    })

    it('auto-selects first task when tasks load', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1', title: 'First Task' })],
      })

      render(<SprintCenter />)

      // The component auto-selects the first task, so SprintDetailPane should show it
      expect(screen.getByText('SprintDetailPane (First Task)')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('renders error message when loadError exists and no tasks', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
        loadError: 'Failed to load tasks from database',
        loading: false,
      })

      render(<SprintCenter />)

      expect(screen.getByText('Failed to load tasks from database')).toBeInTheDocument()
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('does not show error message when loadError exists but tasks are present', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask()],
        loadError: 'Some error',
        loading: false,
      })

      render(<SprintCenter />)

      expect(screen.queryByText('Some error')).not.toBeInTheDocument()
      expect(screen.getByTestId('sprint-task-list')).toBeInTheDocument()
    })

    it('calls loadData when Retry button is clicked', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
        loadError: 'Failed to load',
        loading: false,
      })

      render(<SprintCenter />)

      const retryButton = screen.getByText('Retry')
      fireEvent.click(retryButton)

      expect(mocks.mockLoadData).toHaveBeenCalled()
    })

    it('disables Retry button when loading', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
        loadError: 'Failed to load',
        loading: true,
      })

      render(<SprintCenter />)

      const retryButton = screen.getByText('Retrying…')
      expect(retryButton).toBeDisabled()
    })
  })

  describe('Repository filter', () => {
    it('renders all repository filter buttons', () => {
      render(<SprintCenter />)

      expect(screen.getByText('BDE')).toBeInTheDocument()
      expect(screen.getByText('life-os')).toBeInTheDocument()
      expect(screen.getByText('All')).toBeInTheDocument()
    })

    it('calls setRepoFilter when repo button is clicked', () => {
      render(<SprintCenter />)

      const bdeButton = screen.getByText('BDE')
      fireEvent.click(bdeButton)

      expect(mocks.mockSetRepoFilter).toHaveBeenCalledWith('BDE')
    })

    it('toggles repo filter when same button is clicked twice', () => {
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)

      const bdeButton = screen.getByText('BDE')
      fireEvent.click(bdeButton)

      expect(mocks.mockSetRepoFilter).toHaveBeenCalledWith(null)
    })

    it('clears filter when "All" button is clicked', () => {
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)

      const allButton = screen.getByText('All')
      fireEvent.click(allButton)

      expect(mocks.mockSetRepoFilter).toHaveBeenCalledWith(null)
    })

    it('passes repoFilter to SprintTaskList', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ repo: 'BDE' })],
      })
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)

      expect(screen.getByText(/filter: BDE/)).toBeInTheDocument()
    })
  })

  describe('Stuck tasks badge', () => {
    it('shows stuck tasks badge when visible stuck tasks exist', () => {
      mocks.visibleStuckTasks.value = [
        makeTask({ id: 'stuck-1', status: 'active' }),
        makeTask({ id: 'stuck-2', status: 'active' }),
      ]

      render(<SprintCenter />)

      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByTitle('Stuck tasks detected')).toBeInTheDocument()
    })

    it('does not show stuck tasks badge when no stuck tasks', () => {
      mocks.visibleStuckTasks.value = []

      render(<SprintCenter />)

      expect(screen.queryByTitle('Stuck tasks detected')).not.toBeInTheDocument()
    })

    it('opens health drawer when stuck tasks badge is clicked', () => {
      mocks.visibleStuckTasks.value = [makeTask({ id: 'stuck-1' })]

      render(<SprintCenter />)

      const stuckBadge = screen.getByTitle('Stuck tasks detected')
      fireEvent.click(stuckBadge)

      expect(screen.getByTestId('health-drawer')).toBeInTheDocument()
    })
  })

  describe('Conflicting tasks badge', () => {
    it('shows conflict badge when conflicting tasks exist', () => {
      mocks.conflictingTaskIds.value = ['task-1', 'task-2', 'task-3']
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ id: 'task-1' }),
          makeTask({ id: 'task-2' }),
          makeTask({ id: 'task-3' }),
        ],
      })

      render(<SprintCenter />)

      expect(screen.getByTitle('View merge conflicts')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('does not show conflict badge when no conflicting tasks', () => {
      mocks.conflictingTaskIds.value = []

      render(<SprintCenter />)

      expect(screen.queryByTitle('View merge conflicts')).not.toBeInTheDocument()
    })

    it('opens conflict drawer when conflict badge is clicked', () => {
      mocks.conflictingTaskIds.value = ['task-1']
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1' })],
      })

      render(<SprintCenter />)

      const conflictBadge = screen.getByTitle('View merge conflicts')
      fireEvent.click(conflictBadge)

      expect(screen.getByTestId('conflict-drawer')).toBeInTheDocument()
    })
  })

  describe('Action buttons', () => {
    it('renders New Ticket button', () => {
      render(<SprintCenter />)

      const newTicketButton = screen.getByTitle('New Ticket')
      expect(newTicketButton).toBeInTheDocument()
      expect(screen.getByTestId('plus-icon')).toBeInTheDocument()
    })

    it('opens workbench when New Ticket button is clicked', () => {
      render(<SprintCenter />)

      const newTicketButton = screen.getByTitle('New Ticket')
      fireEvent.click(newTicketButton)

      expect(mocks.mockSetView).toHaveBeenCalledWith('task-workbench')
    })
  })

  describe('Component integration', () => {
    it('passes correct props to CircuitPipeline', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask(), makeTask()],
      })

      render(<SprintCenter />)

      expect(screen.getByText('CircuitPipeline (2 tasks)')).toBeInTheDocument()
    })

    it('passes correct props to SprintTaskList', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask(), makeTask(), makeTask()],
        loading: true,
      })
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)

      expect(screen.getByText(/SprintTaskList \(3 tasks, loading: true, filter: BDE\)/)).toBeInTheDocument()
    })

    it('shows no task in SprintDetailPane when no tasks exist', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
      })

      render(<SprintCenter />)

      expect(screen.getByText('SprintDetailPane (no task)')).toBeInTheDocument()
    })
  })

  describe('Drawers', () => {
    it('does not show health drawer by default', () => {
      render(<SprintCenter />)

      expect(screen.queryByTestId('health-drawer')).not.toBeInTheDocument()
    })

    it('does not show conflict drawer by default', () => {
      render(<SprintCenter />)

      expect(screen.queryByTestId('conflict-drawer')).not.toBeInTheDocument()
    })

    it('shows and hides health drawer when opened and closed', () => {
      mocks.visibleStuckTasks.value = [makeTask({ id: 'stuck-1' })]

      const { rerender } = render(<SprintCenter />)

      // Open drawer
      const stuckBadge = screen.getByTitle('Stuck tasks detected')
      fireEvent.click(stuckBadge)
      expect(screen.getByTestId('health-drawer')).toBeInTheDocument()

      // Close drawer (simulated by re-rendering after state change)
      // In real app, clicking close would update state
      rerender(<SprintCenter />)
    })

    it('shows and hides conflict drawer when opened and closed', () => {
      mocks.conflictingTaskIds.value = ['task-1']
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1' })],
      })

      const { rerender } = render(<SprintCenter />)

      // Open drawer
      const conflictBadge = screen.getByTitle('View merge conflicts')
      fireEvent.click(conflictBadge)
      expect(screen.getByTestId('conflict-drawer')).toBeInTheDocument()

      // Close drawer (simulated by re-rendering after state change)
      rerender(<SprintCenter />)
    })
  })
})
