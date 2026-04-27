import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineOverlays } from '../PipelineOverlays'
import type { SprintTask } from '../../../../../shared/types'
import { nowIso } from '../../../../../shared/time'

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

vi.mock('../SpecPanel', () => ({
  SpecPanel: ({ taskTitle }: { taskTitle: string }) => (
    <div data-testid="spec-panel">Spec: {taskTitle}</div>
  )
}))

vi.mock('../DoneHistoryPanel', () => ({
  DoneHistoryPanel: () => <div data-testid="done-history-panel">DoneHistoryPanel</div>
}))

vi.mock('../ConflictDrawer', () => ({
  ConflictDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="conflict-drawer">ConflictDrawer</div> : null
}))

vi.mock('../HealthCheckDrawer', () => ({
  HealthCheckDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="health-check-drawer">HealthCheckDrawer</div> : null
}))

vi.mock('../../ui/ConfirmModal', () => ({
  ConfirmModal: () => <div data-testid="confirm-modal">ConfirmModal</div>
}))

describe('PipelineOverlays', () => {
  const defaultProps = {
    specPanelOpen: false,
    selectedTask: null,
    onCloseSpec: vi.fn(),
    onSaveSpec: vi.fn(),
    doneViewOpen: false,
    doneTasks: [],
    onCloseDoneView: vi.fn(),
    onTaskClick: vi.fn(),
    conflictDrawerOpen: false,
    conflictingTasks: [],
    onCloseConflict: vi.fn(),
    healthCheckDrawerOpen: false,
    visibleStuckTasks: [],
    onCloseHealthCheck: vi.fn(),
    onDismissStuckTask: vi.fn(),
    confirmProps: {
      open: false,
      title: '',
      message: '',
      onConfirm: vi.fn(),
      onCancel: vi.fn()
    }
  }

  it('always renders ConfirmModal', () => {
    render(<PipelineOverlays {...defaultProps} />)
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
  })

  it('does not render SpecPanel when closed', () => {
    render(<PipelineOverlays {...defaultProps} />)
    expect(screen.queryByTestId('spec-panel')).not.toBeInTheDocument()
  })

  it('renders SpecPanel when open and task has spec', () => {
    const task = makeTask({ id: 't1', title: 'Task with spec', spec: 'Some spec content' })
    render(<PipelineOverlays {...defaultProps} specPanelOpen={true} selectedTask={task} />)
    expect(screen.getByTestId('spec-panel')).toBeInTheDocument()
    expect(screen.getByText('Spec: Task with spec')).toBeInTheDocument()
  })

  it('does not render SpecPanel when open but task has no spec', () => {
    const task = makeTask({ id: 't1', title: 'Task without spec', spec: null })
    render(<PipelineOverlays {...defaultProps} specPanelOpen={true} selectedTask={task} />)
    expect(screen.queryByTestId('spec-panel')).not.toBeInTheDocument()
  })

  it('does not render SpecPanel when open but no task selected', () => {
    render(<PipelineOverlays {...defaultProps} specPanelOpen={true} selectedTask={null} />)
    expect(screen.queryByTestId('spec-panel')).not.toBeInTheDocument()
  })

  it('does not render DoneHistoryPanel when closed', () => {
    render(<PipelineOverlays {...defaultProps} />)
    expect(screen.queryByTestId('done-history-panel')).not.toBeInTheDocument()
  })

  it('renders DoneHistoryPanel when open', () => {
    render(<PipelineOverlays {...defaultProps} doneViewOpen={true} />)
    expect(screen.getByTestId('done-history-panel')).toBeInTheDocument()
  })

  it('does not render ConflictDrawer when closed', () => {
    render(<PipelineOverlays {...defaultProps} />)
    expect(screen.queryByTestId('conflict-drawer')).not.toBeInTheDocument()
  })

  it('renders ConflictDrawer when open', () => {
    render(<PipelineOverlays {...defaultProps} conflictDrawerOpen={true} />)
    expect(screen.getByTestId('conflict-drawer')).toBeInTheDocument()
  })

  it('does not render HealthCheckDrawer when closed', () => {
    render(<PipelineOverlays {...defaultProps} />)
    expect(screen.queryByTestId('health-check-drawer')).not.toBeInTheDocument()
  })

  it('renders HealthCheckDrawer when open', () => {
    render(<PipelineOverlays {...defaultProps} healthCheckDrawerOpen={true} />)
    expect(screen.getByTestId('health-check-drawer')).toBeInTheDocument()
  })

  it('renders multiple overlays simultaneously', () => {
    const task = makeTask({ id: 't1', title: 'Task', spec: 'spec' })
    render(
      <PipelineOverlays
        {...defaultProps}
        specPanelOpen={true}
        selectedTask={task}
        doneViewOpen={true}
        conflictDrawerOpen={true}
        healthCheckDrawerOpen={true}
      />
    )
    expect(screen.getByTestId('spec-panel')).toBeInTheDocument()
    expect(screen.getByTestId('done-history-panel')).toBeInTheDocument()
    expect(screen.getByTestId('conflict-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('health-check-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
  })
})
