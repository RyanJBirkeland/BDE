import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'
import { nowIso } from '../../../../../shared/time'

// vi.hoisted ensures these refs are available inside vi.mock factory functions
const mocks = vi.hoisted(() => {
  const mockLoadData = vi.fn()
  const mockUpdateTask = vi.fn()
  const mockCreateTask = vi.fn()
  const mockSetSelectedTaskId = vi.fn()
  const mockSetDrawerOpen = vi.fn()
  const mockSetSpecPanelOpen = vi.fn()
  const mockSetDoneViewOpen = vi.fn()
  const mockSetView = vi.fn()
  const mockOpenWorkbenchForCreate = vi.fn()
  const mockOpenWorkbenchForEdit = vi.fn()

  const storeState = {
    tasks: [] as SprintTask[],
    loading: false,
    loadError: null as string | null,
    loadData: mockLoadData,
    updateTask: mockUpdateTask,
    createTask: mockCreateTask
  }

  const mockSetConflictDrawerOpen = vi.fn()
  const mockSetHealthCheckDrawerOpen = vi.fn()
  const mockSetStatusFilter = vi.fn()

  const selectionState = {
    selectedTaskId: null as string | null,
    selectedTaskIds: new Set<string>(),
    drawerOpen: false,
    specPanelOpen: false,
    logDrawerTaskId: null as string | null,
    setSelectedTaskId: mockSetSelectedTaskId,
    setDrawerOpen: mockSetDrawerOpen,
    setSpecPanelOpen: mockSetSpecPanelOpen,
    setLogDrawerTaskId: vi.fn(),
    clearMultiSelection: vi.fn()
  }

  const uiState = {
    doneViewOpen: false,
    conflictDrawerOpen: false,
    healthCheckDrawerOpen: false,
    orphanRecoveryBanner: null as null | { recovered: string[]; exhausted: string[] },
    setDoneViewOpen: mockSetDoneViewOpen,
    setConflictDrawerOpen: mockSetConflictDrawerOpen,
    setHealthCheckDrawerOpen: mockSetHealthCheckDrawerOpen,
    setOrphanRecoveryBanner: vi.fn()
  }

  const filtersState = {
    setStatusFilter: mockSetStatusFilter
  }

  return {
    mockLoadData,
    mockUpdateTask,
    mockCreateTask,
    mockSetSelectedTaskId,
    mockSetDrawerOpen,
    mockSetSpecPanelOpen,
    mockSetDoneViewOpen,
    mockSetConflictDrawerOpen,
    mockSetHealthCheckDrawerOpen,
    mockSetStatusFilter,
    mockSetView,
    mockOpenWorkbenchForCreate,
    mockOpenWorkbenchForEdit,
    storeState,
    selectionState,
    uiState,
    filtersState
  }
})

// Mock framer-motion
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  LayoutGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout-group">{children}</div>
  ),
  useReducedMotion: () => false,
  motion: {
    div: ({ children, className, ...rest }: any) => (
      <div className={className} {...rest}>
        {children}
      </div>
    )
  }
}))

// Mock stores
vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.storeState)
    }
    return mocks.storeState
  })
}))

vi.mock('../../../stores/sprintUI', () => ({
  useSprintUI: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.uiState)
    }
    return undefined
  }),
  selectOrphanRecoveryBanner: (s: { orphanRecoveryBanner: null }) => s.orphanRecoveryBanner
}))

vi.mock('../../../stores/sprintSelection', () => ({
  useSprintSelection: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.selectionState)
    }
    return undefined
  })
}))

vi.mock('../../../stores/sprintFilters', () => ({
  useSprintFilters: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mocks.filtersState)
    }
    return undefined
  })
}))

vi.mock('../../../stores/taskWorkbenchModal', () => {
  const state = {
    open: false,
    editingTask: null,
    openForCreate: mocks.mockOpenWorkbenchForCreate,
    openForEdit: mocks.mockOpenWorkbenchForEdit,
    close: vi.fn()
  }
  const useStore = vi.fn((selector?: (s: typeof state) => unknown) =>
    typeof selector === 'function' ? selector(state) : state
  ) as unknown as { (selector?: unknown): unknown; getState: () => typeof state }
  useStore.getState = () => state
  return { useTaskWorkbenchModalStore: useStore }
})

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ setView: mocks.mockSetView })
    }
    return mocks.mockSetView
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

// Mock hooks as no-ops
vi.mock('../../../hooks/useTaskNotifications', () => ({
  setOpenLogDrawerTaskId: vi.fn(),
  useTaskToasts: vi.fn()
}))

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
  useHealthCheckPolling: vi.fn()
}))

vi.mock('../../../stores/healthCheck', () => ({
  useHealthCheckStore: vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      stuckTaskIds: [],
      dismissedIds: [],
      setStuckTasks: vi.fn(),
      dismiss: vi.fn(),
      clearDismissed: vi.fn()
    })
  )
}))

vi.mock('../../../hooks/useVisibleStuckTasks', () => ({
  useVisibleStuckTasks: vi.fn(() => ({
    visibleStuckTasks: [],
    dismissTask: vi.fn()
  }))
}))

// Mock child components
vi.mock('../PipelineBacklog', () => ({
  PipelineBacklog: () => <div data-testid="pipeline-backlog">PipelineBacklog</div>
}))

vi.mock('../PipelineStage', () => ({
  PipelineStage: ({
    name,
    label,
    doneFooter
  }: {
    name: string
    label: string
    doneFooter?: React.ReactNode
  }) => (
    <div data-testid={`pipeline-stage-${name}`}>
      {label}
      {doneFooter}
    </div>
  )
}))

vi.mock('../TaskDetailDrawer', () => ({
  TaskDetailDrawer: ({
    task,
    onClose,
    onViewLogs,
    onOpenSpec,
    onEdit,
    onViewAgents
  }: {
    task: SprintTask
    onClose: () => void
    onViewLogs: (t: SprintTask) => void
    onOpenSpec: () => void
    onEdit: (t: SprintTask) => void
    onViewAgents: (id: string) => void
    onLaunch: (t: SprintTask) => void
    onStop: (t: SprintTask) => void
    onMarkDone: (t: SprintTask) => void
    onRerun: (t: SprintTask) => void
    onDelete: (t: SprintTask) => void
  }) => (
    <div data-testid="task-detail-drawer">
      Drawer: {task.title}
      <button data-testid="drawer-close" onClick={onClose}>
        Close
      </button>
      <button data-testid="drawer-logs" onClick={() => onViewLogs(task)}>
        Logs
      </button>
      <button data-testid="drawer-spec" onClick={onOpenSpec}>
        Spec
      </button>
      <button data-testid="drawer-edit" onClick={() => onEdit(task)}>
        Edit
      </button>
      <button data-testid="drawer-agents" onClick={() => onViewAgents(task.agent_run_id ?? '')}>
        Agents
      </button>
    </div>
  )
}))

vi.mock('../SpecPanel', () => ({
  SpecPanel: ({
    taskTitle,
    onClose,
    onSave
  }: {
    taskTitle: string
    onClose: () => void
    onSave: (spec: string) => void
  }) => (
    <div data-testid="spec-panel">
      Spec: {taskTitle}
      <button data-testid="spec-close" onClick={onClose}>
        Close Spec
      </button>
      <button data-testid="spec-save" onClick={() => onSave('new spec content')}>
        Save Spec
      </button>
    </div>
  )
}))

vi.mock('../DoneHistoryPanel', () => ({
  DoneHistoryPanel: ({
    onClose
  }: {
    onClose: () => void
    tasks: any[]
    onTaskClick: (id: string) => void
  }) => (
    <div data-testid="done-history-panel">
      DoneHistoryPanel
      <button data-testid="dhp-close" onClick={onClose}>
        Close Done
      </button>
    </div>
  )
}))

vi.mock('../ConflictDrawer', () => ({
  ConflictDrawer: ({ open, tasks }: { open: boolean; tasks: any[]; onClose: () => void }) =>
    open ? <div data-testid="conflict-drawer">Conflicts: {tasks.length}</div> : null
}))

vi.mock('../HealthCheckDrawer', () => ({
  HealthCheckDrawer: ({
    open,
    tasks
  }: {
    open: boolean
    tasks: any[]
    onClose: () => void
    onDismiss: (id: string) => void
  }) => (open ? <div data-testid="health-check-drawer">Stuck: {tasks.length}</div> : null)
}))

vi.mock('../NewTicketModal', () => ({
  NewTicketModal: ({
    onClose,
    onCreate
  }: {
    onClose: () => void
    onCreate: (data: any) => void
    open: boolean
  }) => (
    <div data-testid="new-ticket-modal">
      <button data-testid="ntm-close" onClick={onClose}>
        Close
      </button>
      <button
        data-testid="ntm-create"
        onClick={() =>
          onCreate({ title: 'New Task', repo: 'FLEET', prompt: null, priority: 3, depends_on: null })
        }
      >
        Create
      </button>
    </div>
  )
}))

vi.mock('../../ui/ConfirmModal', () => ({
  ConfirmModal: () => <div data-testid="confirm-modal">ConfirmModal</div>
}))

vi.mock('../../../stores/featureFlags', () => ({
  useFeatureFlags: vi.fn((selector: (s: { v2Pipeline: boolean }) => unknown) =>
    selector({ v2Pipeline: false })
  )
}))

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'FLEET',
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
    updated_at: nowIso(),
    created_at: nowIso(),
    ...overrides
  }
}

describe('SprintPipeline', () => {
  beforeEach(() => {
    Object.assign(mocks.storeState, {
      tasks: [],
      loading: false,
      loadError: null,
      loadData: mocks.mockLoadData,
      updateTask: mocks.mockUpdateTask,
      createTask: mocks.mockCreateTask
    })
    Object.assign(mocks.selectionState, {
      selectedTaskId: null,
      drawerOpen: false,
      specPanelOpen: false,
      logDrawerTaskId: null,
      setSelectedTaskId: mocks.mockSetSelectedTaskId,
      setDrawerOpen: mocks.mockSetDrawerOpen,
      setSpecPanelOpen: mocks.mockSetSpecPanelOpen
    })
    Object.assign(mocks.uiState, {
      doneViewOpen: false,
      conflictDrawerOpen: false,
      healthCheckDrawerOpen: false,
      setDoneViewOpen: mocks.mockSetDoneViewOpen,
      setConflictDrawerOpen: mocks.mockSetConflictDrawerOpen,
      setHealthCheckDrawerOpen: mocks.mockSetHealthCheckDrawerOpen
    })
  })

  it('renders pipeline header with "Task Pipeline" title', async () => {
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByText('Task Pipeline')).toBeInTheDocument()
  })

  it('renders 5 pipeline stages (queued, blocked, active, review, done)', async () => {
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByTestId('pipeline-stage-queued')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-blocked')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-active')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-review')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-done')).toBeInTheDocument()
  })

  it('renders PipelineBacklog sidebar', async () => {
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByTestId('pipeline-backlog')).toBeInTheDocument()
  })

  it('shows TaskDetailDrawer when a task is selected', async () => {
    const task = makeTask({ id: 'sel-1', title: 'Selected Task', status: 'active' })
    Object.assign(mocks.storeState, { tasks: [task] })
    Object.assign(mocks.selectionState, { selectedTaskId: 'sel-1', drawerOpen: true })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByTestId('task-detail-drawer')).toBeInTheDocument()
    expect(screen.getByText('Drawer: Selected Task')).toBeInTheDocument()
  })

  it('does not show drawer when no task selected', async () => {
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.queryByTestId('task-detail-drawer')).not.toBeInTheDocument()
  })

  it('shows SpecPanel when specPanelOpen is true', async () => {
    const task = makeTask({ id: 'spec-1', title: 'Spec Task', spec: 'some spec content' })
    Object.assign(mocks.storeState, { tasks: [task] })
    Object.assign(mocks.selectionState, { selectedTaskId: 'spec-1', specPanelOpen: true })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByTestId('spec-panel')).toBeInTheDocument()
  })

  it('shows DoneHistoryPanel when doneViewOpen is true', async () => {
    Object.assign(mocks.uiState, { doneViewOpen: true })
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByTestId('done-history-panel')).toBeInTheDocument()
  })

  it('does not render "+ New Task" button (task creation is in Task Workbench)', async () => {
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.queryByText('+ New Task')).not.toBeInTheDocument()
  })

  it('wraps pipeline stages in LayoutGroup', async () => {
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByTestId('layout-group')).toBeInTheDocument()
  })
})

describe('SprintPipeline - additional scenarios', () => {
  beforeEach(() => {
    Object.assign(mocks.storeState, {
      tasks: [],
      loading: false,
      loadError: null,
      loadData: mocks.mockLoadData,
      updateTask: mocks.mockUpdateTask,
      createTask: mocks.mockCreateTask
    })
    Object.assign(mocks.selectionState, {
      selectedTaskId: null,
      drawerOpen: false,
      specPanelOpen: false,
      logDrawerTaskId: null,
      setSelectedTaskId: mocks.mockSetSelectedTaskId,
      setDrawerOpen: mocks.mockSetDrawerOpen,
      setSpecPanelOpen: mocks.mockSetSpecPanelOpen
    })
    Object.assign(mocks.uiState, {
      doneViewOpen: false,
      conflictDrawerOpen: false,
      healthCheckDrawerOpen: false,
      setDoneViewOpen: mocks.mockSetDoneViewOpen,
      setConflictDrawerOpen: mocks.mockSetConflictDrawerOpen,
      setHealthCheckDrawerOpen: mocks.mockSetHealthCheckDrawerOpen
    })
    mocks.mockSetSelectedTaskId.mockClear()
    mocks.mockSetDoneViewOpen.mockClear()
  })

  it('shows header stats for all 6 buckets', async () => {
    const tasks = [
      makeTask({ id: 'a1', status: 'active' }),
      makeTask({ id: 'a2', status: 'active' }),
      makeTask({ id: 'q1', status: 'queued' }),
      makeTask({ id: 'b1', status: 'blocked' }),
      makeTask({ id: 'd1', status: 'done' }),
      makeTask({ id: 'd2', status: 'done' }),
      makeTask({ id: 'd3', status: 'done' }),
      makeTask({ id: 'f1', status: 'failed' })
    ]
    Object.assign(mocks.storeState, { tasks })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    const header = document.querySelector('.sprint-pipeline__stats')!
    expect(header.textContent).toContain('2')
    expect(header.textContent).toContain('active')
    expect(header.textContent).toContain('1')
    expect(header.textContent).toContain('queued')
    expect(header.textContent).toContain('blocked')
    expect(header.textContent).toContain('review')
    expect(header.textContent).toContain('failed')
    expect(header.textContent).toContain('3')
    expect(header.textContent).toContain('done')
  })

  it('shows 0 for all stats when tasks is empty', async () => {
    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    const header = document.querySelector('.sprint-pipeline__stats')!
    expect(header.textContent).toContain('active')
    expect(header.textContent).toContain('queued')
    expect(header.textContent).toContain('blocked')
    expect(header.textContent).toContain('review')
    expect(header.textContent).toContain('failed')
    expect(header.textContent).toContain('done')
  })

  it('auto-selects first active task when none is selected and active tasks exist', async () => {
    const tasks = [makeTask({ id: 'active-1', status: 'active' })]
    Object.assign(mocks.storeState, { tasks })
    Object.assign(mocks.selectionState, { selectedTaskId: null })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(mocks.mockSetSelectedTaskId).toHaveBeenCalledWith('active-1')
  })

  it('auto-selects first queued task when no active task and queued tasks exist', async () => {
    const tasks = [makeTask({ id: 'queued-1', status: 'queued' })]
    Object.assign(mocks.storeState, { tasks })
    Object.assign(mocks.selectionState, { selectedTaskId: null })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(mocks.mockSetSelectedTaskId).toHaveBeenCalledWith('queued-1')
  })

  it('shows done summary button when more than 3 done tasks', async () => {
    const doneTasks = Array.from({ length: 5 }, (_, i) => makeTask({ id: `d${i}`, status: 'done' }))
    Object.assign(mocks.storeState, { tasks: doneTasks })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.getByText('5 completed · View all')).toBeInTheDocument()
  })

  it('calls setDoneViewOpen(true) when done summary is clicked', async () => {
    const doneTasks = Array.from({ length: 5 }, (_, i) => makeTask({ id: `d${i}`, status: 'done' }))
    Object.assign(mocks.storeState, { tasks: doneTasks })

    const { SprintPipeline } = await import('../SprintPipeline')
    const { fireEvent: fe } = await import('@testing-library/react')
    render(<SprintPipeline />)
    fe.click(screen.getByText('5 completed · View all'))
    expect(mocks.mockSetDoneViewOpen).toHaveBeenCalledWith(true)
  })

  it('does not show done summary when 3 or fewer done tasks', async () => {
    const doneTasks = Array.from({ length: 3 }, (_, i) => makeTask({ id: `d${i}`, status: 'done' }))
    Object.assign(mocks.storeState, { tasks: doneTasks })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(screen.queryByText(/completed · View all/)).not.toBeInTheDocument()
  })

  it('does not auto-select when selectedTaskId is already set', async () => {
    const tasks = [makeTask({ id: 'active-1', status: 'active' })]
    Object.assign(mocks.storeState, { tasks })
    Object.assign(mocks.selectionState, { selectedTaskId: 'already-set' })

    const { SprintPipeline } = await import('../SprintPipeline')
    render(<SprintPipeline />)
    expect(mocks.mockSetSelectedTaskId).not.toHaveBeenCalled()
  })

  it('calls setSpecPanelOpen(false) when SpecPanel close button is clicked', async () => {
    const task = makeTask({ id: 'spec-1', title: 'Spec Task', spec: 'spec content' })
    Object.assign(mocks.storeState, { tasks: [task] })
    Object.assign(mocks.selectionState, { selectedTaskId: 'spec-1', specPanelOpen: true })

    const { SprintPipeline } = await import('../SprintPipeline')
    const { fireEvent: fe } = await import('@testing-library/react')
    render(<SprintPipeline />)
    fe.click(screen.getByTestId('spec-close'))
    expect(mocks.mockSetSpecPanelOpen).toHaveBeenCalledWith(false)
  })

  it('calls setDoneViewOpen(false) when DoneHistoryPanel close button is clicked', async () => {
    Object.assign(mocks.uiState, { doneViewOpen: true })

    const { SprintPipeline } = await import('../SprintPipeline')
    const { fireEvent: fe } = await import('@testing-library/react')
    render(<SprintPipeline />)
    fe.click(screen.getByTestId('dhp-close'))
    expect(mocks.mockSetDoneViewOpen).toHaveBeenCalledWith(false)
  })

  it('calls setView("agents") when drawer onViewLogs is triggered', async () => {
    const task = makeTask({ id: 'active-1', status: 'active' })
    Object.assign(mocks.storeState, { tasks: [task] })
    Object.assign(mocks.selectionState, { selectedTaskId: 'active-1', drawerOpen: true })

    const { SprintPipeline } = await import('../SprintPipeline')
    const { fireEvent: fe } = await import('@testing-library/react')
    render(<SprintPipeline />)
    fe.click(screen.getByTestId('drawer-logs'))
    expect(mocks.mockSetView).toHaveBeenCalledWith('agents')
  })

  it('calls setSpecPanelOpen(true) when drawer onOpenSpec is triggered', async () => {
    const task = makeTask({ id: 'spec-task', status: 'queued' })
    Object.assign(mocks.storeState, { tasks: [task] })
    Object.assign(mocks.selectionState, { selectedTaskId: 'spec-task', drawerOpen: true })

    const { SprintPipeline } = await import('../SprintPipeline')
    const { fireEvent: fe } = await import('@testing-library/react')
    render(<SprintPipeline />)
    fe.click(screen.getByTestId('drawer-spec'))
    expect(mocks.mockSetSpecPanelOpen).toHaveBeenCalledWith(true)
  })

  it('opens the workbench modal in edit mode when drawer onEdit is triggered', async () => {
    const task = makeTask({ id: 'edit-task', status: 'queued' })
    Object.assign(mocks.storeState, { tasks: [task] })
    Object.assign(mocks.selectionState, { selectedTaskId: 'edit-task', drawerOpen: true })
    mocks.mockOpenWorkbenchForEdit.mockClear()
    mocks.mockSetView.mockClear()

    const { SprintPipeline } = await import('../SprintPipeline')
    const { fireEvent: fe } = await import('@testing-library/react')
    render(<SprintPipeline />)
    fe.click(screen.getByTestId('drawer-edit'))

    expect(mocks.mockOpenWorkbenchForEdit).toHaveBeenCalledWith(task)
    expect(mocks.mockSetView).not.toHaveBeenCalledWith('planner')
  })

  it('calls setDrawerOpen(false) and setSelectedTaskId(null) when drawer is closed', async () => {
    const task = makeTask({ id: 'close-task', status: 'queued' })
    Object.assign(mocks.storeState, { tasks: [task] })
    Object.assign(mocks.selectionState, { selectedTaskId: 'close-task', drawerOpen: true })
    mocks.mockSetDrawerOpen.mockClear()
    mocks.mockSetSelectedTaskId.mockClear()

    const { SprintPipeline } = await import('../SprintPipeline')
    const { fireEvent: fe } = await import('@testing-library/react')
    render(<SprintPipeline />)
    fe.click(screen.getByTestId('drawer-close'))
    expect(mocks.mockSetDrawerOpen).toHaveBeenCalledWith(false)
    expect(mocks.mockSetSelectedTaskId).toHaveBeenCalledWith(null)
  })
})
