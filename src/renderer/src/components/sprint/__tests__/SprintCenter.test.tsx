import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SprintCenter } from '../SprintCenter'
import type { SprintTask } from '../../../../../shared/types'

// vi.hoisted ensures these refs are available inside vi.mock factory functions,
// since vi.mock factories are hoisted to run before module-level code
const mocks = vi.hoisted(() => {
  const mockLoadData = vi.fn()
  const mockSetRepoFilter = vi.fn()
  const mockSetSelectedTaskId = vi.fn()
  const mockSetLogDrawerTaskId = vi.fn()
  const mockClearSelection = vi.fn()
  const mockSetView = vi.fn()
  const mockSelectRange = vi.fn()

  // Mutable store state — mutations are picked up by closures in mock factories
  const storeState = {
    tasks: [] as SprintTask[],
    loading: false,
    loadError: null as string | null,
    prMergedMap: {} as Record<string, boolean>,
    // loadData is accessed via (s) => s.loadData selector
    loadData: mockLoadData,
  }

  const uiState = {
    repoFilter: null as string | null,
    selectedTaskId: null as string | null,
    logDrawerTaskId: null as string | null,
    generatingIds: [] as string[],
    selectedTaskIds: [] as string[],
    setRepoFilter: mockSetRepoFilter,
    setSelectedTaskId: mockSetSelectedTaskId,
    setLogDrawerTaskId: mockSetLogDrawerTaskId,
    clearSelection: mockClearSelection,
    selectRange: mockSelectRange,
  }

  // useSprintUI must be both a callable mock AND have a static getState method.
  // We implement it as a plain object with a call method + static method
  // to avoid clearAllMocks wiping the implementation.
  const useSprintUI = Object.assign(
    vi.fn((selector: (s: typeof uiState) => unknown) => {
      if (typeof selector === 'function') {
        return selector(uiState)
      }
      return undefined
    }),
    { getState: () => uiState }
  )

  // Mutable arrays — replace .value to update what closures see
  const conflictingTaskIds = { value: [] as string[] }
  const visibleStuckTasks = { value: [] as SprintTask[] }

  return {
    mockLoadData,
    mockSetRepoFilter,
    mockSetSelectedTaskId,
    mockSetLogDrawerTaskId,
    mockClearSelection,
    mockSetView,
    mockSelectRange,
    storeState,
    uiState,
    useSprintUI,
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
  useSprintUI: mocks.useSprintUI,
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
    handleDragEnd: vi.fn(),
    handleReorder: vi.fn(),
    handlePushToSprint: vi.fn(),
    handleViewSpec: vi.fn(),
    handleSaveSpec: vi.fn(),
    handleMarkDone: vi.fn(),
    handleStop: vi.fn(),
    handleRerun: vi.fn(),
    handleUpdateTitle: vi.fn(),
    handleUpdatePriority: vi.fn(),
    handleEditInWorkbench: vi.fn(),
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

// Mock child components
vi.mock('../KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board">KanbanBoard</div>,
}))

vi.mock('../TaskTable', () => ({
  TaskTable: ({ section }: { section: string }) => <div data-testid={`task-table-${section}`}>TaskTable-{section}</div>,
}))

vi.mock('../SpecDrawer', () => ({
  SpecDrawer: () => <div data-testid="spec-drawer">SpecDrawer</div>,
}))

vi.mock('../LogDrawer', () => ({
  LogDrawer: () => <div data-testid="log-drawer">LogDrawer</div>,
}))

vi.mock('../TaskMonitorPanel', () => ({
  TaskMonitorPanel: () => <div data-testid="task-monitor-panel">TaskMonitorPanel</div>,
}))

vi.mock('../ConflictDrawer', () => ({
  ConflictDrawer: ({ open }: { open: boolean }) => open ? <div data-testid="conflict-drawer">ConflictDrawer</div> : null,
}))

vi.mock('../HealthCheckDrawer', () => ({
  HealthCheckDrawer: ({ open }: { open: boolean }) => open ? <div data-testid="health-drawer">HealthCheckDrawer</div> : null,
}))

vi.mock('../BulkActionBar', () => ({
  BulkActionBar: ({ selectedCount }: { selectedCount: number }) =>
    selectedCount > 0 ? <div data-testid="bulk-action-bar">BulkActionBar ({selectedCount})</div> : null,
}))

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="resizable-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="resizable-panel">{children}</div>,
  Separator: () => <div data-testid="resizable-separator" />,
}))

vi.mock('../../ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
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
    // Note: clearAllMocks is intentionally NOT called here because it would reset
    // the vi.fn() implementations in vi.hoisted() closures that we rely on.
    // Instead we manually reset call counts and state below.
    mocks.mockLoadData.mockClear()
    mocks.mockSetRepoFilter.mockClear()
    mocks.mockSetSelectedTaskId.mockClear()
    mocks.mockSetLogDrawerTaskId.mockClear()
    mocks.mockClearSelection.mockClear()
    mocks.mockSetView.mockClear()
    mocks.mockSelectRange.mockClear()
    // Reset store states
    Object.assign(mocks.storeState, {
      tasks: [],
      loading: false,
      loadError: null,
      prMergedMap: {},
      loadData: mocks.mockLoadData,
    })
    Object.assign(mocks.uiState, {
      repoFilter: null,
      selectedTaskId: null,
      logDrawerTaskId: null,
      generatingIds: [],
      selectedTaskIds: [],
      setRepoFilter: mocks.mockSetRepoFilter,
      setSelectedTaskId: mocks.mockSetSelectedTaskId,
      setLogDrawerTaskId: mocks.mockSetLogDrawerTaskId,
      clearSelection: mocks.mockClearSelection,
      selectRange: mocks.mockSelectRange,
    })
    // Reset mutable mock arrays
    mocks.conflictingTaskIds.value = []
    mocks.visibleStuckTasks.value = []
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
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument()
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

      const retryButton = screen.getByText('Retrying\u2026')
      expect(retryButton).toBeDisabled()
    })
  })

  describe('Loading state', () => {
    it('renders loading skeleton when loading and no tasks', () => {
      Object.assign(mocks.storeState, {
        tasks: [],
        loading: true,
        loadError: null,
      })

      render(<SprintCenter />)

      expect(screen.getByText('To Do')).toBeInTheDocument()
      expect(screen.getByText('In Progress')).toBeInTheDocument()
      expect(screen.getByText('Awaiting Review')).toBeInTheDocument()
      expect(document.querySelectorAll('.sprint-board__skeleton').length).toBeGreaterThan(0)
    })

    it('does not show loading skeleton when tasks are present', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask()],
        loading: true,
        loadError: null,
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('kanban-board')).toBeInTheDocument()
      expect(document.querySelectorAll('.sprint-board__skeleton').length).toBe(0)
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

    it('applies active class to selected repo filter', () => {
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)

      const bdeButton = screen.getByText('BDE').closest('button')
      expect(bdeButton?.className).toContain('sprint-board__repo-chip--active')
    })

    it('filters tasks by selected repository', () => {
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ id: '1', title: 'BDE task', repo: 'BDE', status: 'backlog' }),
          makeTask({ id: '2', title: 'life-os task', repo: 'life-os', status: 'backlog' }),
        ],
      })
      Object.assign(mocks.uiState, { repoFilter: 'BDE' })

      render(<SprintCenter />)
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument()
    })
  })

  describe('Backlog search', () => {
    it('renders search input', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ status: 'backlog' })],
      })
      render(<SprintCenter />)

      const searchInput = screen.getByPlaceholderText('Search backlog...')
      expect(searchInput).toBeInTheDocument()
    })

    it('updates search value when typing', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ status: 'backlog' })],
      })

      render(<SprintCenter />)

      const searchInput = screen.getByPlaceholderText('Search backlog...') as HTMLInputElement
      fireEvent.change(searchInput, { target: { value: 'test query' } })

      expect(searchInput.value).toBe('test query')
    })

    it('shows clear button when search has value', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ status: 'backlog' })],
      })

      render(<SprintCenter />)

      const searchInput = screen.getByPlaceholderText('Search backlog...')
      fireEvent.change(searchInput, { target: { value: 'test' } })

      const clearButton = screen.getByTitle('Clear search')
      expect(clearButton).toBeInTheDocument()
    })

    it('does not show clear button when search is empty', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ status: 'backlog' })],
      })

      render(<SprintCenter />)

      expect(screen.queryByTitle('Clear search')).not.toBeInTheDocument()
    })

    it('clears search when clear button is clicked', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ status: 'backlog' })],
      })

      render(<SprintCenter />)

      const searchInput = screen.getByPlaceholderText('Search backlog...') as HTMLInputElement
      fireEvent.change(searchInput, { target: { value: 'test' } })

      const clearButton = screen.getByTitle('Clear search')
      fireEvent.click(clearButton)

      expect(searchInput.value).toBe('')
    })
  })

  describe('Keyboard shortcuts', () => {
    it('clears selection when Escape is pressed', () => {
      Object.assign(mocks.uiState, {
        selectedTaskIds: ['task-1', 'task-2'],
      })

      render(<SprintCenter />)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(mocks.mockClearSelection).toHaveBeenCalled()
    })

    it('does not clear selection when Escape is pressed with no selection', () => {
      Object.assign(mocks.uiState, {
        selectedTaskIds: [],
      })

      render(<SprintCenter />)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(mocks.mockClearSelection).not.toHaveBeenCalled()
    })

    it('prevents default when Escape clears selection', () => {
      Object.assign(mocks.uiState, {
        selectedTaskIds: ['task-1'],
      })

      render(<SprintCenter />)

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      window.dispatchEvent(event)

      expect(preventDefaultSpy).toHaveBeenCalled()
    })
  })

  describe('Bulk action bar', () => {
    it('shows bulk action bar when tasks are selected', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ status: 'backlog' })],
      })
      Object.assign(mocks.uiState, {
        selectedTaskIds: ['task-1', 'task-2'],
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()
      expect(screen.getByText('BulkActionBar (2)')).toBeInTheDocument()
    })

    it('does not show bulk action bar when no tasks are selected', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ status: 'backlog' })],
      })
      Object.assign(mocks.uiState, {
        selectedTaskIds: [],
      })

      render(<SprintCenter />)

      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument()
    })
  })

  describe('Stuck tasks badge', () => {
    it('shows stuck tasks badge when visible stuck tasks exist', () => {
      mocks.visibleStuckTasks.value = [
        makeTask({ id: 'stuck-1', status: 'active' }),
        makeTask({ id: 'stuck-2', status: 'active' }),
      ]

      render(<SprintCenter />)

      expect(screen.getByText('2 stuck')).toBeInTheDocument()
    })

    it('does not show stuck tasks badge when no stuck tasks', () => {
      mocks.visibleStuckTasks.value = []

      render(<SprintCenter />)

      expect(screen.queryByText(/stuck/)).not.toBeInTheDocument()
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

      expect(screen.getByText('3 conflicts')).toBeInTheDocument()
    })

    it('shows singular "conflict" for single conflicting task', () => {
      mocks.conflictingTaskIds.value = ['task-1']
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1' })],
      })

      render(<SprintCenter />)

      expect(screen.getByText('1 conflict')).toBeInTheDocument()
    })

    it('does not show conflict badge when no conflicting tasks', () => {
      mocks.conflictingTaskIds.value = []

      render(<SprintCenter />)

      expect(screen.queryByText(/conflict/)).not.toBeInTheDocument()
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

  describe('Blocked tasks section', () => {
    it('renders blocked tasks section when blocked tasks exist', () => {
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ id: '1', status: 'blocked', depends_on: [{ id: 'task-0', type: 'hard' }] }),
          makeTask({ id: '2', status: 'blocked', depends_on: [{ id: 'task-0', type: 'hard' }] }),
        ],
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('task-table-blocked')).toBeInTheDocument()
    })

    it('does not render blocked tasks section when no blocked tasks', () => {
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ status: 'backlog' }),
          makeTask({ status: 'done' }),
        ],
      })

      render(<SprintCenter />)

      expect(screen.queryByTestId('task-table-blocked')).not.toBeInTheDocument()
    })
  })

  describe('Failed tasks section', () => {
    it('renders failed tasks section when failed tasks exist', () => {
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ id: '1', status: 'failed' }),
          makeTask({ id: '2', status: 'cancelled' }),
        ],
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('task-table-failed')).toBeInTheDocument()
    })

    it('does not render failed tasks section when no failed tasks', () => {
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ status: 'backlog' }),
          makeTask({ status: 'done' }),
        ],
      })

      render(<SprintCenter />)

      expect(screen.queryByTestId('task-table-failed')).not.toBeInTheDocument()
    })
  })

  describe('Log drawer panel', () => {
    it('renders TaskMonitorPanel when logDrawerTaskId is set', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1', title: 'Task with logs' })],
      })
      Object.assign(mocks.uiState, {
        logDrawerTaskId: 'task-1',
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('task-monitor-panel')).toBeInTheDocument()
      expect(screen.getByTestId('resizable-group')).toBeInTheDocument()
    })

    it('does not render TaskMonitorPanel when logDrawerTaskId is null', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask()],
      })
      Object.assign(mocks.uiState, {
        logDrawerTaskId: null,
      })

      render(<SprintCenter />)

      expect(screen.queryByTestId('task-monitor-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('resizable-group')).not.toBeInTheDocument()
    })

    it('finds correct task for log drawer', () => {
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ id: 'task-1', title: 'Task 1' }),
          makeTask({ id: 'task-2', title: 'Task 2' }),
        ],
      })
      Object.assign(mocks.uiState, {
        logDrawerTaskId: 'task-2',
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('task-monitor-panel')).toBeInTheDocument()
    })

    it('handles missing task gracefully when logDrawerTaskId is invalid', () => {
      Object.assign(mocks.storeState, {
        tasks: [makeTask({ id: 'task-1' })],
      })
      Object.assign(mocks.uiState, {
        logDrawerTaskId: 'non-existent-task',
      })

      render(<SprintCenter />)

      expect(screen.queryByTestId('task-monitor-panel')).not.toBeInTheDocument()
    })
  })

  describe('Action buttons', () => {
    it('opens workbench when "New Ticket" button is clicked', () => {
      render(<SprintCenter />)

      const newTicketButton = screen.getByText('+ New Ticket')
      fireEvent.click(newTicketButton)

      expect(mocks.mockSetView).toHaveBeenCalledWith('task-workbench')
    })

    it('calls loadData when refresh button is clicked', () => {
      render(<SprintCenter />)

      const refreshButton = screen.getByTitle('Refresh')
      fireEvent.click(refreshButton)

      expect(mocks.mockLoadData).toHaveBeenCalled()
    })

    it('disables refresh button when loading', () => {
      Object.assign(mocks.storeState, {
        loading: true,
      })

      render(<SprintCenter />)

      const refreshButton = screen.getByTitle('Refresh')
      expect(refreshButton).toBeDisabled()
    })
  })

  describe('Rendering all sections', () => {
    it('renders backlog, done, kanban board and always-visible components', () => {
      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ status: 'backlog' }),
          makeTask({ status: 'done' }),
        ],
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('kanban-board')).toBeInTheDocument()
      expect(screen.getByTestId('task-table-backlog')).toBeInTheDocument()
      expect(screen.getByTestId('task-table-done')).toBeInTheDocument()
      expect(screen.getByTestId('spec-drawer')).toBeInTheDocument()
      expect(screen.getByTestId('log-drawer')).toBeInTheDocument()
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    })

    it('renders all conditional sections when conditions are met', () => {
      mocks.conflictingTaskIds.value = ['task-1']
      mocks.visibleStuckTasks.value = [makeTask({ id: 'stuck-1' })]

      Object.assign(mocks.storeState, {
        tasks: [
          makeTask({ id: 'task-1', status: 'backlog' }),
          makeTask({ status: 'blocked', depends_on: [{ id: 'task-0', type: 'hard' }] }),
          makeTask({ status: 'failed' }),
        ],
      })

      render(<SprintCenter />)

      expect(screen.getByTestId('task-table-blocked')).toBeInTheDocument()
      expect(screen.getByTestId('task-table-failed')).toBeInTheDocument()
      expect(screen.getByText('1 conflict')).toBeInTheDocument()
      expect(screen.getByText('1 stuck')).toBeInTheDocument()
    })
  })
})
