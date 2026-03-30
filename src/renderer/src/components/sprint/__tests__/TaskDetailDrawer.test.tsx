import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'
import { TaskDetailDrawer } from '../TaskDetailDrawer'

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

  it('shows correct action buttons for failed status (Re-run, Edit, Delete)', () => {
    const task: SprintTask = { ...baseTask, status: 'failed' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Re-run')).toBeInTheDocument()
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

  it('shows Re-run button for done status', () => {
    const task: SprintTask = { ...baseTask, status: 'done' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Re-run')).toBeInTheDocument()
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

  it('shows correct action buttons for error status (Re-run, Edit, Delete)', () => {
    const task: SprintTask = { ...baseTask, status: 'error' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Re-run')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows correct action buttons for cancelled status (Re-run, Edit, Delete)', () => {
    const task: SprintTask = { ...baseTask, status: 'cancelled' }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Re-run')).toBeInTheDocument()
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

  it('calls onRerun when Re-run button clicked (done)', () => {
    const task: SprintTask = { ...baseTask, status: 'done' }
    const props = makeProps({ task })
    render(<TaskDetailDrawer {...props} />)
    fireEvent.click(screen.getByText('Re-run'))
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

  it('shows dependency count when task has depends_on', () => {
    const task: SprintTask = {
      ...baseTask,
      depends_on: [
        { id: 'dep-1', type: 'hard' },
        { id: 'dep-2', type: 'soft' }
      ]
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText('Dependencies')).toBeInTheDocument()
    expect(screen.getByText(/2 deps/)).toBeInTheDocument()
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

  it('shows singular "dep" label for one dependency', () => {
    const task: SprintTask = {
      ...baseTask,
      depends_on: [{ id: 'dep-1', type: 'hard' }]
    }
    render(<TaskDetailDrawer {...makeProps({ task })} />)
    expect(screen.getByText(/1 dep —/)).toBeInTheDocument()
  })

  it('shows branch-only section with Create PR link when pr_status is branch_only', () => {
    const task: SprintTask = {
      ...baseTask,
      status: 'done',
      pr_status: 'branch_only',
      notes: 'Branch agent/fix-foo pushed to RyanBirkeland/BDE but PR creation failed after 3 attempts'
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
