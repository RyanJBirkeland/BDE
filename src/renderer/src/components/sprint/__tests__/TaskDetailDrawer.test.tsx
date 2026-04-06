import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'
import { TaskDetailDrawer } from '../TaskDetailDrawer'
import { useSprintTasks } from '../../../stores/sprintTasks'
import { useSprintUI } from '../../../stores/sprintUI'

const baseTask: SprintTask = {
  id: 'task-1',
  title: 'Implement login flow',
  repo: 'BDE',
  prompt: 'Build the login page with OAuth support',
  priority: 2,
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
  updated_at: '2026-03-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z'
}

const depTask1: SprintTask = {
  ...baseTask,
  id: 'dep-1',
  title: 'Setup auth module',
  status: 'done'
}

const depTask2: SprintTask = {
  ...baseTask,
  id: 'dep-2',
  title: 'Create user model',
  status: 'active'
}

function makeProps(overrides: Partial<Parameters<typeof TaskDetailDrawer>[0]> = {}) {
  return {
    task: baseTask,
    onClose: vi.fn(),
    onLaunch: vi.fn(),
    onStop: vi.fn(),
    onMarkDone: vi.fn(),
    onRerun: vi.fn(),
    onDelete: vi.fn(),
    onViewLogs: vi.fn(),
    onOpenSpec: vi.fn(),
    onEdit: vi.fn(),
    onViewAgents: vi.fn(),
    ...overrides
  }
}

describe('TaskDetailDrawer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
    useSprintTasks.setState({ tasks: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders task title', () => {
    render(<TaskDetailDrawer {...makeProps()} />)
    expect(screen.getByText('Implement login flow')).toBeInTheDocument()
  })

  it('shows prompt in monospace block', () => {
    render(<TaskDetailDrawer {...makeProps()} />)
    const prompt = screen.getByText('Build the login page with OAuth support')
    expect(prompt.closest('.task-drawer__prompt')).toBeTruthy()
  })

  it('shows "View Spec →" link when task.spec exists', () => {
    const task: SprintTask = { ...baseTask, spec: '# Login Spec\nDetails here' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('View Spec →')).toBeInTheDocument()
  })

  it('does NOT show spec link when task.spec is null', () => {
    render(<TaskDetailDrawer {...makeProps()} />)
    expect(screen.queryByText('View Spec →')).not.toBeInTheDocument()
  })

  it('shows correct action buttons for queued status (Launch, Edit, Delete)', () => {
    render(<TaskDetailDrawer {...makeProps()} />)
    expect(screen.getByText('Launch')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows correct action buttons for active status (View Logs, Edit, Stop)', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'active',
      started_at: '2026-03-01T11:00:00Z'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('View Logs')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Stop')).toBeInTheDocument()
  })

  it('shows correct action buttons for failed status (Clone & Queue, Edit, Delete)', () => {
    const task: SprintTask = { ...baseTask, status: 'failed' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Clone & Queue')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('calls onLaunch when Launch button clicked', () => {
    const props = makeProps()
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('Launch'))
    expect(props.onLaunch).toHaveBeenCalledWith(baseTask)
  })

  it('calls onStop when Stop button clicked', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'active',
      started_at: '2026-03-01T11:00:00Z'
    }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('Stop'))
    expect(props.onStop).toHaveBeenCalledWith(task)
  })

  it('calls onOpenSpec when "View Spec →" clicked', () => {
    const task: SprintTask = { ...baseTask, spec: '# Spec content' }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('View Spec →'))
    expect(props.onOpenSpec).toHaveBeenCalled()
  })

  it('shows agent link when agent_run_id exists', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'active',
      agent_run_id: 'agent-42',
      started_at: '2026-03-01T11:00:00Z'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText(/View in Agents/)).toBeInTheDocument()
  })
})

describe('TaskDetailDrawer - additional status combos', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
    useSprintTasks.setState({ tasks: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows correct action buttons for backlog status (Launch, Edit, Delete)', () => {
    const task: SprintTask = { ...baseTask, status: 'backlog' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getAllByText('Launch')[0]).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows correct action buttons for blocked status (Unblock, Edit)', () => {
    const task: SprintTask = { ...baseTask, status: 'blocked' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Unblock')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('shows Clone & Queue button for done status', () => {
    const task: SprintTask = { ...baseTask, status: 'done' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Clone & Queue')).toBeInTheDocument()
  })

  it('shows View PR link for done task with pr_url', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'done',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
      pr_status: 'open'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('View PR')).toBeInTheDocument()
  })

  it('shows correct action buttons for error status (Clone & Queue, Edit, Delete)', () => {
    const task: SprintTask = { ...baseTask, status: 'error' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Clone & Queue')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows correct action buttons for cancelled status (Clone & Queue, Edit, Delete)', () => {
    const task: SprintTask = { ...baseTask, status: 'cancelled' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Clone & Queue')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('calls onLaunch when Launch button clicked (backlog)', () => {
    const task: SprintTask = { ...baseTask, status: 'backlog' }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getAllByText('Launch')[0])
    expect(props.onLaunch).toHaveBeenCalledWith(task)
  })

  it('calls onRerun when Clone & Queue button clicked (done)', () => {
    const task: SprintTask = { ...baseTask, status: 'done' }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('Clone & Queue'))
    expect(props.onRerun).toHaveBeenCalledWith(task)
  })

  it('calls onDelete when Delete button clicked (backlog)', () => {
    const task: SprintTask = { ...baseTask, status: 'backlog' }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(props.onDelete).toHaveBeenCalledWith(task)
  })

  it('calls onViewLogs when View Logs button clicked (active)', () => {
    const task: SprintTask = { ...baseTask, status: 'active', started_at: '2026-03-01T11:00:00Z' }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('View Logs'))
    expect(props.onViewLogs).toHaveBeenCalledWith(task)
  })

  it('calls onEdit when Edit button clicked (blocked)', () => {
    const task: SprintTask = { ...baseTask, status: 'blocked' }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('Edit'))
    expect(props.onEdit).toHaveBeenCalledWith(task)
  })

  it('calls onClose when close button is clicked', () => {
    const props = makeProps()
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByLabelText('Close drawer'))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows status text in status area for active task', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'active',
      started_at: '2026-03-01T11:00:00Z'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows PR number and status in PR section', () => {
    const task: SprintTask = {
      ...baseTask,
      pr_url: 'https://github.com/org/repo/pull/7',
      pr_number: 7,
      pr_status: 'open'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('#7 (open)')).toBeInTheDocument()
  })

  it('shows "unknown" for PR status when pr_status is null', () => {
    const task: SprintTask = {
      ...baseTask,
      pr_url: 'https://github.com/org/repo/pull/8',
      pr_number: 8,
      pr_status: null
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('#8 (unknown)')).toBeInTheDocument()
  })

  it('shows interactive dependency list when task has depends_on', () => {
    useSprintTasks.setState({ tasks: [depTask1, depTask2] })
    const task: SprintTask = {
      ...baseTask,
      depends_on: [
        { id: 'dep-1', type: 'hard' },
        { id: 'dep-2', type: 'soft' }
      ]
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Dependencies')).toBeInTheDocument()
    // Task titles and statuses appear in both dependencies and upstream outcomes sections
    expect(screen.getAllByText('Setup auth module').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Create user model').length).toBeGreaterThan(0)
    expect(screen.getAllByText('done').length).toBeGreaterThan(0)
  })

  it('shows "Blocked by" label for blocked task dependencies', () => {
    useSprintTasks.setState({ tasks: [depTask2] })
    const task: SprintTask = {
      ...baseTask,
      status: 'blocked',
      depends_on: [{ id: 'dep-2', type: 'hard' }]
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Blocked by')).toBeInTheDocument()
    // Task title appears in both dependencies and upstream outcomes sections
    expect(screen.getAllByText('Create user model').length).toBeGreaterThan(0)
  })

  it('navigates to dependency task when clicked', () => {
    useSprintTasks.setState({ tasks: [depTask1] })
    const task: SprintTask = {
      ...baseTask,
      depends_on: [{ id: 'dep-1', type: 'hard' }]
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    // Click the first instance (from dependencies section, also appears in upstream outcomes)
    fireEvent.click(screen.getAllByText('Setup auth module')[0])
    expect(useSprintUI.getState().selectedTaskId).toBe('dep-1')
  })

  it('does not show dependency section when depends_on is null', () => {
    render(<TaskDetailDrawer {...makeProps()} />)
    expect(screen.queryByText('Dependencies')).not.toBeInTheDocument()
    expect(screen.queryByText('Blocked by')).not.toBeInTheDocument()
  })

  it('shows Started field when task has started_at', () => {
    const task: SprintTask = {
      ...baseTask,
      started_at: '2026-03-01T10:00:00Z'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Started')).toBeInTheDocument()
  })

  it('calls onViewAgents with agentId when agent link is clicked', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'active',
      agent_run_id: 'agent-99',
      started_at: '2026-03-01T11:00:00Z'
    }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText(/View in Agents/))
    expect(props.onViewAgents).toHaveBeenCalledWith('agent-99')
  })

  it('shows branch-only section with Create PR link when pr_status is branch_only', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'done',
      pr_status: 'branch_only',
      notes:
        'Branch agent/fix-foo pushed to RyanBirkeland/BDE but PR creation failed after 3 attempts'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    const section = screen.getByTestId('branch-only-section')
    expect(section).toBeInTheDocument()
    expect(screen.getByText(/PR creation failed/)).toBeInTheDocument()
    const link = screen.getByText('Create PR →')
    expect(link).toBeInTheDocument()
    // URL components are encoded for security (SP-10 fix)
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/RyanBirkeland%2FBDE/pull/new/agent%2Ffix-foo'
    )
  })

  it('shows branch-only section without link when notes do not match pattern', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'done',
      pr_status: 'branch_only',
      notes: 'Some other note without branch info'
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    const section = screen.getByTestId('branch-only-section')
    expect(section).toBeInTheDocument()
    expect(screen.getByText(/PR creation failed/)).toBeInTheDocument()
    expect(screen.queryByText('Create PR →')).not.toBeInTheDocument()
  })
})

describe('TaskDetailDrawer - loading states', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
    useSprintTasks.setState({ tasks: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('disables all buttons while action is loading', async () => {
    const props = makeProps()
    let resolveAction: () => void
    const actionPromise = new Promise<void>((resolve) => {
      resolveAction = resolve
    })
    props.onLaunch = vi.fn(() => actionPromise)

    render(<TaskDetailDrawer {...props} />)

    const launchBtn = screen.getByText('Launch')
    const editBtn = screen.getByText('Edit')
    const deleteBtn = screen.getByText('Delete')

    // Before click - all enabled
    expect(launchBtn).not.toBeDisabled()
    expect(editBtn).not.toBeDisabled()
    expect(deleteBtn).not.toBeDisabled()

    // Click launch
    fireEvent.click(launchBtn)

    // While loading - all disabled
    await vi.waitFor(() => {
      expect(launchBtn).toBeDisabled()
      expect(editBtn).toBeDisabled()
      expect(deleteBtn).toBeDisabled()
    })

    // Resolve action
    resolveAction!()
    await actionPromise

    // After completion - all enabled again
    await vi.waitFor(() => {
      expect(launchBtn).not.toBeDisabled()
      expect(editBtn).not.toBeDisabled()
      expect(deleteBtn).not.toBeDisabled()
    })
  })

  it('sets aria-busy on the active button', async () => {
    const props = makeProps()
    let resolveAction: () => void
    const actionPromise = new Promise<void>((resolve) => {
      resolveAction = resolve
    })
    props.onDelete = vi.fn(() => actionPromise)

    render(<TaskDetailDrawer {...props} />)

    const deleteBtn = screen.getByText('Delete')

    // Before click
    expect(deleteBtn).toHaveAttribute('aria-busy', 'false')

    // Click delete
    fireEvent.click(deleteBtn)

    // While loading
    await vi.waitFor(() => {
      expect(deleteBtn).toHaveAttribute('aria-busy', 'true')
    })

    // Resolve action
    resolveAction!()
    await actionPromise

    // After completion
    await vi.waitFor(() => {
      expect(deleteBtn).toHaveAttribute('aria-busy', 'false')
    })
  })

  it('shows spinner icon on loading button (active status)', async () => {
    const task: SprintTask = { ...baseTask, status: 'active', started_at: '2026-03-01T11:00:00Z' }
    const props = makeProps({ task })
    let resolveAction: () => void
    const actionPromise = new Promise<void>((resolve) => {
      resolveAction = resolve
    })
    props.onStop = vi.fn(() => actionPromise)

    render(<TaskDetailDrawer {...props} />)

    const stopBtn = screen.getByText('Stop')

    // Click stop
    fireEvent.click(stopBtn)

    // While loading - spinner should be present
    await vi.waitFor(() => {
      const spinner = stopBtn.querySelector('.spinner')
      expect(spinner).toBeInTheDocument()
    })

    // Resolve action
    resolveAction!()
    await actionPromise

    // After completion - spinner removed
    await vi.waitFor(() => {
      const spinner = stopBtn.querySelector('.spinner')
      expect(spinner).not.toBeInTheDocument()
    })
  })

  it('clears loading state on error', async () => {
    const props = makeProps()
    // Mock console.error to suppress error output
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    props.onLaunch = vi.fn(async () => {
      throw new Error('Launch failed')
    })

    render(<TaskDetailDrawer {...props} />)

    const launchBtn = screen.getByText('Launch')
    const editBtn = screen.getByText('Edit')

    fireEvent.click(launchBtn)

    // Should become disabled
    await vi.waitFor(() => {
      expect(launchBtn).toBeDisabled()
    })

    // After error - should re-enable
    await vi.waitFor(() => {
      expect(launchBtn).not.toBeDisabled()
      expect(editBtn).not.toBeDisabled()
    })

    consoleError.mockRestore()
  })

  it('shows spinner on Clone & Queue button when loading (done status)', async () => {
    const task: SprintTask = { ...baseTask, status: 'done' }
    const props = makeProps({ task })
    let resolveAction: () => void
    const actionPromise = new Promise<void>((resolve) => {
      resolveAction = resolve
    })
    props.onRerun = vi.fn(() => actionPromise)

    render(<TaskDetailDrawer {...props} />)

    const cloneBtn = screen.getByText('Clone & Queue')

    fireEvent.click(cloneBtn)

    // While loading
    await vi.waitFor(() => {
      expect(cloneBtn).toBeDisabled()
      const spinner = cloneBtn.querySelector('.spinner')
      expect(spinner).toBeInTheDocument()
    })

    resolveAction!()
    await actionPromise

    // After completion
    await vi.waitFor(() => {
      expect(cloneBtn).not.toBeDisabled()
    })
  })
})

describe('TaskDetailDrawer - focus management', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
    useSprintTasks.setState({ tasks: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('focuses the title heading when mounted', () => {
    const task: SprintTask = { ...baseTask, status: 'active' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    const heading = screen.getByRole('heading', { name: task.title })
    expect(heading).toHaveFocus()
  })

  it('title heading has tabIndex -1 for programmatic focus', () => {
    const task: SprintTask = { ...baseTask, status: 'active' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    const heading = screen.getByRole('heading', { name: task.title })
    expect(heading).toHaveAttribute('tabindex', '-1')
  })
})

describe('TaskDetailDrawer - Review Changes button', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
    useSprintTasks.setState({ tasks: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows "Review Changes" button for tasks in review status', () => {
    const task: SprintTask = { ...baseTask, status: 'review' }
    render(<TaskDetailDrawer {...makeProps({ task, onReviewChanges: vi.fn() })} />)
    expect(screen.getByRole('button', { name: /review changes/i })).toBeInTheDocument()
  })

  it('does not show "Review Changes" button for non-review tasks', () => {
    const task: SprintTask = { ...baseTask, status: 'active' }
    render(<TaskDetailDrawer {...makeProps({ task, onReviewChanges: vi.fn() })} />)
    expect(screen.queryByRole('button', { name: /review changes/i })).not.toBeInTheDocument()
  })

  it('does not show "Review Changes" button when onReviewChanges prop is not provided', () => {
    const task: SprintTask = { ...baseTask, status: 'review' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.queryByRole('button', { name: /review changes/i })).not.toBeInTheDocument()
  })

  it('calls onReviewChanges when button is clicked', () => {
    const onReviewChanges = vi.fn()
    const task: SprintTask = { ...baseTask, status: 'review' }
    render(<TaskDetailDrawer {...makeProps({ task, onReviewChanges })} />)
    fireEvent.click(screen.getByRole('button', { name: /review changes/i }))
    expect(onReviewChanges).toHaveBeenCalledWith(task)
  })

  describe('failure details', () => {
    it('renders notes prominently when task status is failed', () => {
      const task: SprintTask = {
        ...baseTask,
        status: 'failed',
        notes: 'npm test exited with code 1\nAssertionError in src/foo.test.ts'
      }
      render(<TaskDetailDrawer {...makeProps({ task })} />)
      const block = screen.getByTestId('task-drawer-failure')
      expect(block).toBeInTheDocument()
      expect(screen.getByTestId('task-drawer-failure-notes').textContent).toContain(
        'npm test exited with code 1'
      )
      expect(screen.getByText('Failure Details')).toBeInTheDocument()
    })

    it('renders notes block when task status is error', () => {
      const task: SprintTask = {
        ...baseTask,
        status: 'error',
        notes: 'Worktree evicted before completion',
        failure_reason: 'unknown'
      }
      render(<TaskDetailDrawer {...makeProps({ task })} />)
      expect(screen.getByTestId('task-drawer-failure')).toBeInTheDocument()
      expect(screen.getByTestId('task-drawer-failure-reason').textContent).toContain('unknown')
    })

    it('does not render failure block for non-failed statuses', () => {
      for (const status of ['queued', 'active', 'done', 'review'] as const) {
        const { unmount } = render(
          <TaskDetailDrawer {...makeProps({ task: { ...baseTask, status, notes: 'x' } })} />
        )
        expect(screen.queryByTestId('task-drawer-failure')).toBeNull()
        unmount()
      }
    })

    it('shows placeholder text when failed task has no notes', () => {
      const task: SprintTask = { ...baseTask, status: 'failed', notes: null }
      render(<TaskDetailDrawer {...makeProps({ task })} />)
      expect(screen.getByText(/No diagnostic notes captured/)).toBeInTheDocument()
    })
  })
})
