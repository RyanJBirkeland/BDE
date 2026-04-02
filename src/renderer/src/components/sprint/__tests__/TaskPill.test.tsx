import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: '2026-03-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z'
}

describe('TaskPill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders task title', async () => {
    const { TaskPill } = await import('../TaskPill')
    render(<TaskPill task={baseTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('Implement login flow')).toBeInTheDocument()
  })

  it('renders repo badge', async () => {
    const { TaskPill } = await import('../TaskPill')
    render(<TaskPill task={baseTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('BDE')).toBeInTheDocument()
  })

  it('applies selected class when selected=true', async () => {
    const { TaskPill } = await import('../TaskPill')
    render(<TaskPill task={baseTask} selected={true} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).toContain('task-pill--selected')
  })

  it('does not apply selected class when selected=false', async () => {
    const { TaskPill } = await import('../TaskPill')
    render(<TaskPill task={baseTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).not.toContain('task-pill--selected')
  })

  it('applies active class for active tasks', async () => {
    const { TaskPill } = await import('../TaskPill')
    const activeTask: SprintTask = { ...baseTask, status: 'active' }
    render(<TaskPill task={activeTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).toContain('task-pill--active')
  })

  it('applies blocked class for blocked tasks', async () => {
    const { TaskPill } = await import('../TaskPill')
    const blockedTask: SprintTask = { ...baseTask, status: 'blocked' }
    render(<TaskPill task={blockedTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).toContain('task-pill--blocked')
  })

  it('applies review class for active tasks with pr_status=open', async () => {
    const { TaskPill } = await import('../TaskPill')
    const reviewTask: SprintTask = { ...baseTask, status: 'active', pr_status: 'open' }
    render(<TaskPill task={reviewTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).toContain('task-pill--review')
  })

  it('calls onClick with task id when clicked', async () => {
    const { TaskPill } = await import('../TaskPill')
    const onClick = vi.fn()
    render(<TaskPill task={baseTask} selected={false} onClick={onClick} />)
    screen.getByTestId('task-pill').click()
    expect(onClick).toHaveBeenCalledWith('task-1')
  })

  it('shows elapsed time for active tasks with started_at', async () => {
    const { TaskPill } = await import('../TaskPill')
    const now = new Date('2026-03-01T10:00:00Z').getTime()
    vi.setSystemTime(now)
    const startedAt = new Date(now - 75 * 60 * 1000).toISOString() // 75 minutes ago
    const activeTask: SprintTask = { ...baseTask, status: 'active', started_at: startedAt }
    render(<TaskPill task={activeTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('1h 15m')).toBeInTheDocument()
  })

  it('does not show elapsed time for non-active tasks', async () => {
    const { TaskPill } = await import('../TaskPill')
    const now = new Date('2026-03-01T10:00:00Z').getTime()
    vi.setSystemTime(now)
    const startedAt = new Date(now - 30 * 60 * 1000).toISOString()
    const doneTask: SprintTask = { ...baseTask, status: 'done', started_at: startedAt }
    render(<TaskPill task={doneTask} selected={false} onClick={vi.fn()} />)
    expect(screen.queryByText(/\d+m/)).not.toBeInTheDocument()
  })

  it('does not show elapsed time for active tasks without started_at', async () => {
    const { TaskPill } = await import('../TaskPill')
    const activeTask: SprintTask = { ...baseTask, status: 'active', started_at: null }
    render(<TaskPill task={activeTask} selected={false} onClick={vi.fn()} />)
    // elapsed span should not be present
    const pill = screen.getByTestId('task-pill')
    expect(pill.querySelector('.task-pill__time')).toBeNull()
  })
})

describe('TaskPill - additional status classes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies done class for done tasks without open PR', async () => {
    const { TaskPill } = await import('../TaskPill')
    const doneTask: SprintTask = { ...baseTask, status: 'done', pr_status: null }
    render(<TaskPill task={doneTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).toContain('task-pill--done')
  })

  it('applies review class for done tasks with open PR', async () => {
    const { TaskPill } = await import('../TaskPill')
    const reviewTask: SprintTask = { ...baseTask, status: 'done', pr_status: 'open' }
    render(<TaskPill task={reviewTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).toContain('task-pill--review')
  })

  it('applies branch-only class for tasks with pr_status=branch_only', async () => {
    const { TaskPill } = await import('../TaskPill')
    const branchOnlyTask: SprintTask = { ...baseTask, status: 'active', pr_status: 'branch_only' }
    render(<TaskPill task={branchOnlyTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByTestId('task-pill')
    expect(pill.className).toContain('task-pill--branch-only')
  })

  it('shows elapsed time under 60 minutes correctly (e.g. 30m)', async () => {
    const { TaskPill } = await import('../TaskPill')
    const now = new Date('2026-03-01T10:00:00Z').getTime()
    vi.setSystemTime(now)
    const startedAt = new Date(now - 30 * 60 * 1000).toISOString()
    const activeTask: SprintTask = { ...baseTask, status: 'active', started_at: startedAt }
    render(<TaskPill task={activeTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('30m')).toBeInTheDocument()
  })
})
