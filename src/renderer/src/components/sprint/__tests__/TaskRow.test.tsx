import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskRow } from '../TaskRow'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, onClick, 'data-testid': testId, ...rest }: any) => (
      <div className={className} onClick={onClick} data-testid={testId} {...rest}>
        {children}
      </div>
    )
  }
}))

const baseTask: SprintTask = {
  id: 'task-1',
  title: 'Implement login flow',
  repo: 'BDE',
  prompt: null,
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
  pr_mergeable_state: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: '2026-03-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z'
}

describe('TaskRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders task title', () => {
    render(<TaskRow task={baseTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('Implement login flow')).toBeInTheDocument()
  })

  it('renders repo badge', () => {
    render(<TaskRow task={baseTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('BDE')).toBeInTheDocument()
  })

  it('applies selected class when selected=true', () => {
    render(<TaskRow task={baseTask} selected={true} onClick={vi.fn()} />)
    const row = screen.getByTestId('task-row')
    expect(row.className).toContain('task-row--selected')
  })

  it('does not apply selected class when selected=false', () => {
    render(<TaskRow task={baseTask} selected={false} onClick={vi.fn()} />)
    const row = screen.getByTestId('task-row')
    expect(row.className).not.toContain('task-row--selected')
  })

  it('calls onClick with task id when clicked', () => {
    const onClick = vi.fn()
    render(<TaskRow task={baseTask} selected={false} onClick={onClick} />)
    const row = screen.getByTestId('task-row')
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledWith('task-1')
  })

  it('calls onClick when Enter key is pressed', () => {
    const onClick = vi.fn()
    render(<TaskRow task={baseTask} selected={false} onClick={onClick} />)
    const row = screen.getByTestId('task-row')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onClick).toHaveBeenCalledWith('task-1')
  })

  it('calls onClick when Space key is pressed', () => {
    const onClick = vi.fn()
    render(<TaskRow task={baseTask} selected={false} onClick={onClick} />)
    const row = screen.getByTestId('task-row')
    fireEvent.keyDown(row, { key: ' ' })
    expect(onClick).toHaveBeenCalledWith('task-1')
  })

  it('does not call onClick for other keys', () => {
    const onClick = vi.fn()
    render(<TaskRow task={baseTask} selected={false} onClick={onClick} />)
    const row = screen.getByTestId('task-row')
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders priority badge when priority is set', () => {
    const taskWithPriority: SprintTask = { ...baseTask, priority: 1 }
    render(<TaskRow task={taskWithPriority} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
  })

  it('does not render priority badge when priority is 0', () => {
    const taskNoPriority: SprintTask = { ...baseTask, priority: 0 }
    render(<TaskRow task={taskNoPriority} selected={false} onClick={vi.fn()} />)
    expect(screen.queryByText(/^P\d$/)).not.toBeInTheDocument()
  })

  it('renders elapsed time for active tasks', () => {
    const now = new Date('2026-03-01T12:00:00Z')
    vi.setSystemTime(now)

    const activeTask: SprintTask = {
      ...baseTask,
      status: 'active',
      started_at: new Date('2026-03-01T11:30:00Z').toISOString()
    }
    render(<TaskRow task={activeTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('30m 0s')).toBeInTheDocument()
  })

  it('does not render elapsed time for non-active tasks', () => {
    const queuedTask: SprintTask = {
      ...baseTask,
      status: 'queued',
      started_at: new Date('2026-03-01T11:30:00Z').toISOString()
    }
    render(<TaskRow task={queuedTask} selected={false} onClick={vi.fn()} />)
    expect(screen.queryByText('30m')).not.toBeInTheDocument()
  })

  it('has correct accessibility attributes', () => {
    render(<TaskRow task={baseTask} selected={false} onClick={vi.fn()} />)
    const row = screen.getByTestId('task-row')
    expect(row).toHaveAttribute('role', 'button')
    expect(row).toHaveAttribute('tabIndex', '0')
    expect(row).toHaveAttribute('aria-label', 'Task: Implement login flow, status: queued')
  })
})
