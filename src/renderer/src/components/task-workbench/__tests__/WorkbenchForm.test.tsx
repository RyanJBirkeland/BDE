import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock child components to isolate WorkbenchForm
vi.mock('../SpecEditor', () => ({
  SpecEditor: ({ generating }: { generating: boolean }) => (
    <div data-testid="spec-editor">{generating ? 'Generating...' : 'SpecEditor'}</div>
  )
}))
vi.mock('../ValidationChecks', () => ({
  ValidationChecks: () => <div data-testid="validation-checks">ValidationChecks</div>
}))
vi.mock('../WorkbenchActions', () => ({
  WorkbenchActions: ({
    onSaveBacklog,
    onQueueNow,
    submitting
  }: {
    onSaveBacklog: () => void
    onQueueNow: () => void
    onLaunch: () => void
    submitting: boolean
  }) => (
    <div data-testid="workbench-actions">
      <button data-testid="save-backlog" onClick={onSaveBacklog} disabled={submitting}>
        Save to Backlog
      </button>
      <button data-testid="queue-now" onClick={onQueueNow} disabled={submitting}>
        Queue Now
      </button>
    </div>
  )
}))
vi.mock('../../ui/ConfirmModal', () => ({
  ConfirmModal: ({
    open,
    onConfirm,
    onCancel
  }: {
    open: boolean
    onConfirm: () => void
    onCancel: () => void
  }) =>
    open ? (
      <div data-testid="confirm-modal">
        <button data-testid="confirm-yes" onClick={onConfirm}>
          Confirm
        </button>
        <button data-testid="confirm-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null
}))
vi.mock('../../../hooks/useValidationChecks', () => ({
  useValidationChecks: vi.fn()
}))

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [
    { label: 'BDE', owner: 'RyanJBirkeland', color: '#6C8EEF' },
    { label: 'life-os', owner: 'RyanJBirkeland', color: '#00D37F' }
  ]
}))

const mockCreateTask = vi.fn().mockResolvedValue('new-task-id')
vi.mock('../../../hooks/useSprintTaskActions', () => ({
  useSprintTaskActions: () => ({
    createTask: mockCreateTask,
    handleSaveSpec: vi.fn(),
    handleStop: vi.fn(),
    handleRerun: vi.fn(),
    handleRetry: vi.fn(),
    launchTask: vi.fn(),
    deleteTask: vi.fn(),
    batchDeleteTasks: vi.fn(),
    confirmProps: { open: false, onConfirm: vi.fn(), onCancel: vi.fn(), message: '' }
  })
}))

import { WorkbenchForm } from '../WorkbenchForm'
import { useTaskWorkbenchStore } from '../../../stores/taskWorkbench'
import { useSprintTasks } from '../../../stores/sprintTasks'

describe('WorkbenchForm', () => {
  const mockOnSendCopilotMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateTask.mockClear()
    mockCreateTask.mockResolvedValue('new-task-id')
    useTaskWorkbenchStore.getState().resetForm()

    // Add workbench API mocks
    ;(window.api as any).workbench = {
      checkSpec: vi.fn().mockResolvedValue({
        clarity: { status: 'pass', message: 'OK' },
        scope: { status: 'pass', message: 'OK' },
        filesExist: { status: 'pass', message: 'OK' }
      }),
      checkOperational: vi.fn().mockResolvedValue({
        auth: { status: 'pass', message: 'OK' },
        repoPath: { status: 'pass', message: 'OK' },
        gitClean: { status: 'pass', message: 'OK' },
        noConflict: { status: 'pass', message: 'OK' },
        slotsAvailable: { status: 'pass', message: 'OK' }
      }),
      generateSpec: vi.fn().mockResolvedValue({ spec: '## Generated spec' }),
      chat: vi.fn().mockResolvedValue({ content: 'response' })
    }
  })

  it('renders title field and repo select', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByText('Title *')).toBeInTheDocument()
    expect(screen.getByText('Repo')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Add recipe search/i)).toBeInTheDocument()
  })

  it('renders "New Task" heading in create mode', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByText('New Task')).toBeInTheDocument()
  })

  it('renders "Edit:" heading in edit mode', () => {
    useTaskWorkbenchStore.setState({ mode: 'edit', title: 'Fix bug' })
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByText('Edit: Fix bug')).toBeInTheDocument()
  })

  it('renders "Edit: Untitled" when edit mode with empty title', () => {
    useTaskWorkbenchStore.setState({ mode: 'edit', title: '' })
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByText('Edit: Untitled')).toBeInTheDocument()
  })

  it('updates store title on input change', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    const input = screen.getByPlaceholderText(/Add recipe search/i)
    fireEvent.change(input, { target: { value: 'New task title' } })
    expect(useTaskWorkbenchStore.getState().title).toBe('New task title')
  })

  it('updates store repo on select change', () => {
    useTaskWorkbenchStore.setState({ repo: 'BDE' })
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    const select = screen.getByDisplayValue('BDE')
    fireEvent.change(select, { target: { value: 'life-os' } })
    expect(useTaskWorkbenchStore.getState().repo).toBe('life-os')
  })

  it('renders SpecEditor child', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByTestId('spec-editor')).toBeInTheDocument()
  })

  it('renders ValidationChecks child', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByTestId('validation-checks')).toBeInTheDocument()
  })

  it('renders WorkbenchActions child', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByTestId('workbench-actions')).toBeInTheDocument()
  })

  it('toggles advanced options when "Advanced" clicked', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    // Priority is always visible (moved out of Advanced section)
    expect(screen.getByText('Priority')).toBeInTheDocument()
    // Dev Playground is inside Advanced (collapsed by default)
    expect(screen.queryByText('Dev Playground')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/Advanced/))
    expect(screen.getByText('Dev Playground')).toBeInTheDocument()
  })

  it('shows priority select always (not gated by advanced)', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    expect(screen.getByText('P3 Medium')).toBeInTheDocument()
  })

  it('updates priority from form', () => {
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    const prioritySelect = screen.getByDisplayValue('P3 Medium')
    fireEvent.change(prioritySelect, { target: { value: '1' } })
    expect(useTaskWorkbenchStore.getState().priority).toBe(1)
  })

  it('toggles playground checkbox', () => {
    useTaskWorkbenchStore.setState({ advancedOpen: true })
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    expect(useTaskWorkbenchStore.getState().playgroundEnabled).toBe(true)
  })

  it('calls createTask on save to backlog', async () => {
    useTaskWorkbenchStore.setState({ title: 'Test task', repo: 'BDE', spec: 'Some spec' })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('save-backlog'))

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalled()
    })
  })

  it('calls updateTask in edit mode', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined)
    useSprintTasks.setState({ updateTask: mockUpdate })
    useTaskWorkbenchStore.setState({
      mode: 'edit',
      taskId: 'task-1',
      title: 'Updated task',
      repo: 'BDE',
      spec: 'Updated spec'
    })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('save-backlog'))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ title: 'Updated task', status: 'backlog' })
      )
    })
  })

  it('runs operational checks on queue and blocks if fail', async () => {
    ;(window.api as any).workbench.checkOperational = vi.fn().mockResolvedValue({
      auth: { status: 'fail', message: 'No auth' },
      repoPath: { status: 'pass', message: 'OK' },
      gitClean: { status: 'pass', message: 'OK' },
      noConflict: { status: 'pass', message: 'OK' },
      slotsAvailable: { status: 'pass', message: 'OK' }
    })
    useTaskWorkbenchStore.setState({ title: 'Test task', repo: 'BDE' })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('queue-now'))

    await waitFor(() => {
      expect((window.api as any).workbench.checkOperational).toHaveBeenCalled()
    })
    // Should NOT have created task because op check failed
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('shows confirm modal when queue has warnings', async () => {
    ;(window.api as any).workbench.checkOperational = vi.fn().mockResolvedValue({
      auth: { status: 'pass', message: 'OK' },
      repoPath: { status: 'pass', message: 'OK' },
      gitClean: { status: 'warn', message: 'Dirty' },
      noConflict: { status: 'pass', message: 'OK' },
      slotsAvailable: { status: 'pass', message: 'OK' }
    })
    useTaskWorkbenchStore.setState({ title: 'Test task', repo: 'BDE' })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('queue-now'))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    })
  })

  it('confirm modal cancel dismisses it', async () => {
    ;(window.api as any).workbench.checkOperational = vi.fn().mockResolvedValue({
      auth: { status: 'pass', message: 'OK' },
      repoPath: { status: 'pass', message: 'OK' },
      gitClean: { status: 'warn', message: 'Dirty' },
      noConflict: { status: 'pass', message: 'OK' },
      slotsAvailable: { status: 'pass', message: 'OK' }
    })
    useTaskWorkbenchStore.setState({ title: 'Test task', repo: 'BDE' })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('queue-now'))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('confirm-cancel'))
    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
  })

  it('handleConfirmedQueue creates and queues task in create mode', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined)
    useSprintTasks.setState({
      updateTask: mockUpdate,
      tasks: []
    })
    mockCreateTask.mockResolvedValue('new-1')
    useTaskWorkbenchStore.setState({ title: 'Test task', repo: 'BDE' })

    // Make it show the confirm modal (warn state)
    ;(window.api as any).workbench.checkOperational = vi.fn().mockResolvedValue({
      auth: { status: 'pass', message: 'OK' },
      repoPath: { status: 'pass', message: 'OK' },
      gitClean: { status: 'warn', message: 'Dirty' },
      noConflict: { status: 'pass', message: 'OK' },
      slotsAvailable: { status: 'pass', message: 'OK' }
    })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('queue-now'))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('confirm-yes'))

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalled()
      expect(mockUpdate).toHaveBeenCalledWith(
        'new-1',
        expect.objectContaining({ status: 'queued' })
      )
    })
  })

  it('handleConfirmedQueue updates task in edit mode', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined)
    useSprintTasks.setState({ updateTask: mockUpdate, tasks: [] })
    useTaskWorkbenchStore.setState({
      mode: 'edit',
      taskId: 'task-99',
      title: 'Edit me',
      repo: 'BDE'
    })
    ;(window.api as any).workbench.checkOperational = vi.fn().mockResolvedValue({
      auth: { status: 'pass', message: 'OK' },
      repoPath: { status: 'pass', message: 'OK' },
      gitClean: { status: 'warn', message: 'Dirty' },
      noConflict: { status: 'pass', message: 'OK' },
      slotsAvailable: { status: 'pass', message: 'OK' }
    })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('queue-now'))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('confirm-yes'))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'task-99',
        expect.objectContaining({ status: 'queued' })
      )
    })
  })

  it('includes dependsOn when non-empty', async () => {
    useTaskWorkbenchStore.setState({
      title: 'With deps',
      repo: 'BDE',
      dependsOn: [{ task_id: 'dep-1', depends_on_task_id: 'dep-2' }] as any
    })

    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)
    fireEvent.click(screen.getByTestId('save-backlog'))

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          depends_on: expect.arrayContaining([expect.objectContaining({ task_id: 'dep-1' })])
        })
      )
    })
  })

  it('does not show a per-task model picker in advanced options', () => {
    // Model routing lives in Settings → Models per agent type; the per-task
    // picker was removed because the underlying `task.model` field is dead in
    // the default Claude backend. The Advanced section keeps cost/playground,
    // but the model select is gone.
    useTaskWorkbenchStore.setState({ advancedOpen: true })
    render(<WorkbenchForm onSendCopilotMessage={mockOnSendCopilotMessage} />)

    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument()
    expect(screen.queryByText('Default (Sonnet)')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude Opus 4')).not.toBeInTheDocument()
  })
})
