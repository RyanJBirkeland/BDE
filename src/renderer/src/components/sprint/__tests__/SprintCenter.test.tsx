import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SprintCenter } from '../SprintCenter'
import type { SprintTask } from '../../../../../shared/types'

// vi.hoisted ensures these refs are available inside vi.mock factory functions
const mocks = vi.hoisted(() => {
  const mockLoadData = vi.fn()
  const mockSetRepoFilter = vi.fn()
  const mockSetLogDrawerTaskId = vi.fn()
  const mockSetView = vi.fn()

  const storeState = {
    tasks: [] as SprintTask[],
    loading: false,
    loadError: null as string | null,
    loadData: mockLoadData
  }

  const uiState = {
    repoFilter: null as string | null,
    logDrawerTaskId: null as string | null,
    setRepoFilter: mockSetRepoFilter,
    setLogDrawerTaskId: mockSetLogDrawerTaskId
  }

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
    visibleStuckTasks
  }
})

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.storeState)
    }
    return mocks.mockLoadData
  })
}))

vi.mock('../../../stores/sprintUI', () => ({
  useSprintUI: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.uiState)
    }
    return undefined
  })
}))

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ setView: mocks.mockSetView })
    }
    return mocks.mockSetView
  })
}))

vi.mock('../../../stores/prConflicts', () => ({
  usePrConflictsStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ conflictingTaskIds: mocks.conflictingTaskIds.value })
    }
    return mocks.conflictingTaskIds.value
  })
}))

vi.mock('../../../stores/sprintEvents', () => ({
  useSprintEvents: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ initTaskOutputListener: () => () => {} })
    }
    return () => () => {}
  })
}))

vi.mock('../../../hooks/useTaskNotifications', () => ({
  setOpenLogDrawerTaskId: vi.fn(),
  useTaskToasts: vi.fn()
}))

vi.mock('../../../hooks/useSprintPolling', () => ({ useSprintPolling: vi.fn() }))
vi.mock('../../../hooks/usePrStatusPolling', () => ({ usePrStatusPolling: vi.fn() }))
vi.mock('../../../hooks/useSprintKeyboardShortcuts', () => ({
  useSprintKeyboardShortcuts: vi.fn()
}))

vi.mock('../../../hooks/useSprintTaskActions', () => ({
  useSprintTaskActions: () => ({
    handleSaveSpec: vi.fn(),
    handleMarkDone: vi.fn(),
    handleStop: vi.fn(),
    handleRerun: vi.fn(),
    launchTask: vi.fn(),
    deleteTask: vi.fn(),
    confirmProps: { open: false, title: '', message: '', onConfirm: vi.fn(), onCancel: vi.fn() }
  })
}))

vi.mock('../../../hooks/useHealthCheck', () => ({
  useHealthCheck: vi.fn(() => ({
    visibleStuckTasks: mocks.visibleStuckTasks.value,
    dismissTask: vi.fn()
  }))
}))

// Mock child components for the three-zone layout
vi.mock('../CircuitPipeline', () => ({
  CircuitPipeline: ({ tasks }: { tasks: SprintTask[] }) => (
    <div data-testid="circuit-pipeline">Pipeline ({tasks.length} tasks)</div>
  )
}))

vi.mock('../SprintTaskList', () => ({
  SprintTaskList: ({
    tasks,
    onSelectTask
  }: {
    tasks: SprintTask[]
    onSelectTask: (t: SprintTask) => void
  }) => (
    <div data-testid="sprint-task-list">
      {tasks.map((t) => (
        <button key={t.id} data-testid={`task-${t.id}`} onClick={() => onSelectTask(t)}>
          {t.title}
        </button>
      ))}
    </div>
  )
}))

vi.mock('../SprintDetailPane', () => ({
  SprintDetailPane: ({ task }: { task: SprintTask | null }) => (
    <div data-testid="sprint-detail-pane">
      {task ? `Detail: ${task.title}` : 'No task selected'}
    </div>
  )
}))

vi.mock('../ConflictDrawer', () => ({
  ConflictDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="conflict-drawer">ConflictDrawer</div> : null
}))

vi.mock('../HealthCheckDrawer', () => ({
  HealthCheckDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="health-drawer">HealthCheckDrawer</div> : null
}))

vi.mock('../../ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: React.ComponentProps<'button'>) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  )
}))

vi.mock('../../ui/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('../../ui/ConfirmModal', () => ({
  ConfirmModal: () => <div data-testid="confirm-modal">ConfirmModal</div>
}))

vi.mock('../../ui/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
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

describe('SprintCenter', () => {
  beforeEach(() => {
    mocks.mockLoadData.mockClear()
    mocks.mockSetRepoFilter.mockClear()
    mocks.mockSetLogDrawerTaskId.mockClear()
    mocks.mockSetView.mockClear()

    Object.assign(mocks.storeState, {
      tasks: [],
      loading: false,
      loadError: null,
      loadData: mocks.mockLoadData
    })
    Object.assign(mocks.uiState, {
      repoFilter: null,
      logDrawerTaskId: null,
      setRepoFilter: mocks.mockSetRepoFilter,
      setLogDrawerTaskId: mocks.mockSetLogDrawerTaskId
    })
    mocks.conflictingTaskIds.value = []
    mocks.visibleStuckTasks.value = []
  })

  describe('Three-zone layout', () => {
    it('renders CircuitPipeline with tasks', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask(), makeTask()]
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('circuit-pipeline')).toBeInTheDocument()
      expect(screen.getByText('Pipeline (2 tasks)')).toBeInTheDocument()
    })

    it('renders SprintTaskList', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ title: 'My task' })]
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('sprint-task-list')).toBeInTheDocument()
      expect(screen.getByText('My task')).toBeInTheDocument()
    })

    it('renders SprintDetailPane', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1', title: 'Selected task' })]
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('sprint-detail-pane')).toBeInTheDocument()
    })

    it('auto-selects first task when none selected', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1', title: 'First task' })]
      })

      render(<SprintCenter />)

      expect(screen.getByText('Detail: First task')).toBeInTheDocument()
    })

    it('shows no-selection state when no tasks', () => {
      render(<SprintCenter />)

      expect(screen.getByText('No task selected')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('renders error message when loadError exists and no tasks', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
        loadError: 'Failed to load tasks from database',
        loading: false
      })

      render(<SprintCenter />)

      expect(screen.getByText('Failed to load tasks from database')).toBeInTheDocument()
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('calls loadData when Retry button is clicked', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
        loadError: 'Failed to load',
        loading: false
      })

      render(<SprintCenter />)

      fireEvent.click(screen.getByText('Retry'))

      expect(mocks.mockLoadData).toHaveBeenCalled()
    })

    it('shows Retrying text when loading', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
        loadError: 'Failed to load',
        loading: true
      })

      render(<SprintCenter />)

      expect(screen.getByText('Retrying\u2026')).toBeDisabled()
    })
  })

  describe('Repository filter', () => {
    it('renders repo filter buttons', () => {
      render(<SprintCenter />)

      expect(screen.getByText('BDE')).toBeInTheDocument()
      expect(screen.getByText('life-os')).toBeInTheDocument()
      expect(screen.getByText('All')).toBeInTheDocument()
    })

    it('calls setRepoFilter when repo button is clicked', () => {
      render(<SprintCenter />)

      fireEvent.click(screen.getByText('BDE'))

      expect(mocks.mockSetRepoFilter).toHaveBeenCalledWith('BDE')
    })

    it('toggles repo filter off when same button clicked', () => {
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)

      fireEvent.click(screen.getByText('BDE'))

      expect(mocks.mockSetRepoFilter).toHaveBeenCalledWith(null)
    })

    it('clears filter when All is clicked', () => {
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)

      fireEvent.click(screen.getByText('All'))

      expect(mocks.mockSetRepoFilter).toHaveBeenCalledWith(null)
    })
  })

  describe('Stuck tasks', () => {
    it('shows stuck badge when stuck tasks exist', () => {
      mocks.visibleStuckTasks.value = [makeTask(), makeTask()]

      render(<SprintCenter />)

      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByTitle('Stuck tasks detected')).toBeInTheDocument()
    })

    it('opens health drawer when stuck badge clicked', () => {
      mocks.visibleStuckTasks.value = [makeTask()]

      render(<SprintCenter />)

      fireEvent.click(screen.getByTitle('Stuck tasks detected'))

      expect(screen.getByTestId('health-drawer')).toBeInTheDocument()
    })
  })

  describe('Conflicts', () => {
    it('shows conflict badge when conflicting tasks exist', () => {
      mocks.conflictingTaskIds.value = ['task-1']
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1' })]
      })

      render(<SprintCenter />)

      expect(screen.getByTitle('View merge conflicts')).toBeInTheDocument()
    })

    it('opens conflict drawer when badge clicked', () => {
      mocks.conflictingTaskIds.value = ['task-1']
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1' })]
      })

      render(<SprintCenter />)

      fireEvent.click(screen.getByTitle('View merge conflicts'))

      expect(screen.getByTestId('conflict-drawer')).toBeInTheDocument()
    })
  })

  describe('Action buttons', () => {
    it('opens workbench when new ticket button is clicked', () => {
      render(<SprintCenter />)

      fireEvent.click(screen.getByTitle('New Ticket'))

      expect(mocks.mockSetView).toHaveBeenCalledWith('task-workbench')
    })
  })
})
