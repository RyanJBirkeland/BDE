/**
 * SprintPipelineV2 — minimal smoke coverage.
 *
 * The full V2 pipeline pulls from ~10 stores and 7 hooks; this test stubs the
 * orchestrator hook (useSprintPipelineState) and the heaviest child components
 * so we can verify the V2 dispatcher renders the V2 surface and reacts to the
 * essential interactions (task selection, drawer display).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'
import { nowIso } from '../../../../../shared/time'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>
  },
  LayoutGroup: ({ children }: any) => <>{children}</>,
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => false
}))

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {}, default: {} },
  REDUCED_TRANSITION: {},
  useReducedMotion: () => false
}))

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'fleet',
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

const setSelectedTaskId = vi.fn()
const setDrawerOpen = vi.fn()
const setSpecPanelOpen = vi.fn()
const setLogDrawerTaskId = vi.fn()
const clearMultiSelection = vi.fn()
const toggleTaskSelection = vi.fn()
const setDoneViewOpen = vi.fn()
const setConflictDrawerOpen = vi.fn()
const setHealthCheckDrawerOpen = vi.fn()
const updateTask = vi.fn()
const loadData = vi.fn()
const batchRequeueTasks = vi.fn()
const selectCodeReviewTask = vi.fn()
const initTaskOutputListener = vi.fn(() => () => {})

const emptyPartition = {
  backlog: [] as SprintTask[],
  todo: [] as SprintTask[],
  blocked: [] as SprintTask[],
  inProgress: [] as SprintTask[],
  pendingReview: [] as SprintTask[],
  approved: [] as SprintTask[],
  openPrs: [] as SprintTask[],
  done: [] as SprintTask[],
  failed: [] as SprintTask[]
}

let pipelineStateOverrides: Record<string, unknown> = {}
let sprintTasksOverrides: Record<string, unknown> = {}
let drainStatusOverride: unknown = null
let sprintUIOverrides: Record<string, unknown> = {}

vi.mock('../../../hooks/useSprintPipelineState', () => ({
  useSprintPipelineState: () => ({
    tasks: [],
    loading: false,
    loadError: null,
    updateTask,
    loadData,
    batchRequeueTasks,
    selectedTaskId: null,
    selectedTaskIds: new Set<string>(),
    drawerOpen: false,
    specPanelOpen: false,
    logDrawerTaskId: null,
    setSelectedTaskId,
    setDrawerOpen,
    setSpecPanelOpen,
    setLogDrawerTaskId,
    clearMultiSelection,
    toggleTaskSelection,
    doneViewOpen: false,
    conflictDrawerOpen: false,
    healthCheckDrawerOpen: false,
    setDoneViewOpen,
    setConflictDrawerOpen,
    setHealthCheckDrawerOpen,
    selectCodeReviewTask,
    initTaskOutputListener,
    filteredTasks: [] as SprintTask[],
    filteredPartition: emptyPartition,
    partition: emptyPartition,
    selectedTask: null,
    conflictingTasks: [] as SprintTask[],
    ...pipelineStateOverrides
  })
}))

vi.mock('../../../hooks/useSprintTaskActions', () => ({
  useSprintTaskActions: () => ({
    handleSaveSpec: vi.fn(),
    handleStop: vi.fn(),
    handleRerun: vi.fn(),
    handleRetry: vi.fn(),
    launchTask: vi.fn(),
    deleteTask: vi.fn(),
    batchDeleteTasks: vi.fn(),
    unblockTask: vi.fn().mockResolvedValue(undefined),
    markTaskFailed: vi.fn().mockResolvedValue(undefined),
    forceTaskDone: vi.fn().mockResolvedValue(undefined),
    releaseTask: vi.fn().mockResolvedValue(undefined),
    confirmProps: { open: false, title: '', message: '', onConfirm: vi.fn(), onCancel: vi.fn() }
  })
}))

vi.mock('../../../hooks/useVisibleStuckTasks', () => ({
  useVisibleStuckTasks: () => ({ visibleStuckTasks: [], dismissTask: vi.fn() })
}))

vi.mock('../../../hooks/useDrainStatus', () => ({
  useDrainStatus: () => drainStatusOverride
}))

vi.mock('../../../hooks/useNow', () => ({
  useNow: () => Date.now()
}))

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [{ name: 'fleet', label: 'fleet' }]
}))

vi.mock('../../../hooks/useTaskNotifications', () => ({
  setOpenLogDrawerTaskId: vi.fn(),
  useTaskToasts: vi.fn()
}))

vi.mock('../../../hooks/useSprintKeyboardShortcuts', () => ({
  useSprintKeyboardShortcuts: vi.fn()
}))

vi.mock('../../../hooks/useSprintPipelineCommands', () => ({
  useSprintPipelineCommands: vi.fn()
}))

vi.mock('../../../stores/sprintFilters', () => ({
  useSprintFilters: vi.fn((sel: any) => sel({ setStatusFilter: vi.fn() }))
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: any) =>
    sel({
      pollError: null,
      clearPollError: vi.fn(),
      tasks: [],
      exportTaskHistory: vi.fn(),
      ...sprintTasksOverrides
    })
  )
}))

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((sel: any) => sel({ setView: vi.fn() }))
}))

vi.mock('../../../stores/sprintUI', () => ({
  useSprintUI: vi.fn((sel: any) =>
    sel({
      orphanRecoveryBanner: null,
      setOrphanRecoveryBanner: vi.fn(),
      ...sprintUIOverrides
    })
  ),
  selectOrphanRecoveryBanner: (s: any) => s.orphanRecoveryBanner
}))

vi.mock('../../../stores/taskWorkbenchModal', () => ({
  useTaskWorkbenchModalStore: vi.fn((sel: any) => sel({ openForCreate: vi.fn() }))
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

// Force the dispatcher to render V2.
vi.mock('../../../stores/featureFlags', () => ({
  useFeatureFlags: vi.fn((sel: any) => sel({ v2Pipeline: true }))
}))

// Stub heavy children
vi.mock('../PipelineHeaderV2', () => ({
  PipelineHeaderV2: () => <div data-testid="pipeline-header-v2">Header</div>
}))
vi.mock('../PipelineBacklogV2', () => ({
  PipelineBacklogV2: () => <div data-testid="pipeline-backlog-v2">Backlog</div>
}))
vi.mock('../PipelineStageV2', () => ({
  PipelineStageV2: ({ name, label }: any) => (
    <div data-testid={`pipeline-stage-v2-${name}`}>{label}</div>
  )
}))
vi.mock('../TaskDetailDrawerV2', () => ({
  TaskDetailDrawerV2: ({ task }: any) => (
    <div data-testid="task-detail-drawer-v2">Drawer: {task?.title ?? ''}</div>
  )
}))
vi.mock('../PipelineFilterBarV2', () => ({
  PipelineFilterBarV2: () => <div data-testid="pipeline-filter-bar-v2" />
}))
vi.mock('../PipelineFilterBanner', () => ({
  PipelineFilterBanner: () => null
}))
vi.mock('../PipelineOverlays', () => ({
  PipelineOverlays: () => null
}))
vi.mock('../DagOverlay', () => ({ DagOverlay: () => null }))
vi.mock('../BulkActionBar', () => ({ BulkActionBar: () => null }))
vi.mock('../PipelineErrorBoundary', () => ({
  PipelineErrorBoundary: ({ children }: any) => <>{children}</>
}))
vi.mock('../banners/PollErrorBanner', () => ({
  PollErrorBanner: ({ message, onRetry, onDismiss }: any) => (
    <div data-testid="poll-error-banner">
      <span>{message}</span>
      <button onClick={onRetry}>Retry</button>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}))
vi.mock('../banners/DrainPausedBanner', () => ({
  DrainPausedBanner: ({ reason }: any) => (
    <div data-testid="drain-paused-banner">{reason}</div>
  )
}))
vi.mock('../banners/OrphanRecoveryBanner', () => ({
  OrphanRecoveryBanner: ({ recoveredCount, onDismiss }: any) => (
    <div data-testid="orphan-recovery-banner">
      <span>Recovered: {recoveredCount}</span>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}))

import { SprintPipeline } from '../SprintPipeline'

describe('V2 pipeline (via SprintPipeline dispatcher)', () => {
  beforeEach(() => {
    pipelineStateOverrides = {}
    sprintTasksOverrides = {}
    drainStatusOverride = null
    sprintUIOverrides = {}
    setSelectedTaskId.mockClear()
  })

  it('renders the V2 pipeline scaffolding without crashing', () => {
    render(<SprintPipeline />)
    expect(screen.getByTestId('sprint-pipeline')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-header-v2')).toBeInTheDocument()
  })

  it('shows the backlog when there are tasks present', () => {
    pipelineStateOverrides = {
      tasks: [makeTask({ id: 't1', status: 'backlog' })],
      filteredPartition: { ...emptyPartition, backlog: [makeTask({ id: 't1' })] },
      partition: { ...emptyPartition, backlog: [makeTask({ id: 't1' })] }
    }
    render(<SprintPipeline />)
    expect(screen.getByTestId('pipeline-backlog-v2')).toBeInTheDocument()
  })

  it('shows the task detail drawer when a task is selected', () => {
    const selected = makeTask({ id: 'sel', title: 'Selected Task', status: 'active' })
    pipelineStateOverrides = {
      tasks: [selected],
      selectedTaskId: 'sel',
      drawerOpen: true,
      selectedTask: selected,
      filteredPartition: { ...emptyPartition, inProgress: [selected] },
      partition: { ...emptyPartition, inProgress: [selected] }
    }
    render(<SprintPipeline />)
    expect(screen.getByTestId('task-detail-drawer-v2')).toBeInTheDocument()
    expect(screen.getByText('Drawer: Selected Task')).toBeInTheDocument()
  })

  it('shows the empty-state "No tasks yet" message when there are zero tasks', () => {
    render(<SprintPipeline />)
    expect(screen.getByText('No tasks yet')).toBeInTheDocument()
  })

  it('renders six pipeline stages when tasks exist', () => {
    const t1 = makeTask({ id: 't1', status: 'queued' })
    pipelineStateOverrides = {
      tasks: [t1],
      filteredPartition: { ...emptyPartition, todo: [t1] },
      partition: { ...emptyPartition, todo: [t1] }
    }
    render(<SprintPipeline />)
    expect(screen.getByTestId('pipeline-stage-v2-queued')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-v2-blocked')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-v2-active')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-v2-review')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-v2-open-prs')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-stage-v2-done')).toBeInTheDocument()
  })

  it('renders the loading skeleton when loading is true and tasks are empty', () => {
    pipelineStateOverrides = { loading: true, tasks: [] }
    render(<SprintPipeline />)
    expect(screen.getByRole('status', { name: 'Loading pipeline' })).toBeInTheDocument()
  })

  it('renders PipelineLoadError with a retry button when loadError is set', () => {
    pipelineStateOverrides = {
      loading: false,
      loadError: 'Network timeout',
      tasks: []
    }
    render(<SprintPipeline />)
    expect(screen.getByText('Network timeout')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: 'Retry' })
    expect(retryBtn).toBeInTheDocument()
    fireEvent.click(retryBtn)
    expect(loadData).toHaveBeenCalled()
  })

  it('renders PollErrorBanner when pollError is non-null', () => {
    sprintTasksOverrides = { pollError: 'Poll failed', clearPollError: vi.fn() }
    render(<SprintPipeline />)
    expect(screen.getByTestId('poll-error-banner')).toBeInTheDocument()
    expect(screen.getByText('Poll failed')).toBeInTheDocument()
  })

  it('renders DrainPausedBanner when drainStatus is set', () => {
    drainStatusOverride = {
      reason: 'rate-limit',
      affectedTaskCount: 2,
      pausedUntil: Date.now() + 60_000
    }
    render(<SprintPipeline />)
    expect(screen.getByTestId('drain-paused-banner')).toBeInTheDocument()
    expect(screen.getByText('rate-limit')).toBeInTheDocument()
  })
})
