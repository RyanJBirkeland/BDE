import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineBacklog } from '../PipelineBacklog'
import type { SprintTask } from '../../../../../shared/types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    repo: 'my-repo',
    prompt: null,
    priority: 3,
    status: 'backlog',
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
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('PipelineBacklog', () => {
  const onTaskClick = vi.fn()
  const onAddToQueue = vi.fn()
  const onRerun = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders backlog tasks with titles', () => {
    const backlog = [makeTask({ id: 'b1', title: 'Backlog Task One' })]
    render(
      <PipelineBacklog
        backlog={backlog}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('Backlog Task One')).toBeInTheDocument()
  })

  it('renders backlog count badge', () => {
    const backlog = [makeTask({ id: 'b1' }), makeTask({ id: 'b2' })]
    render(
      <PipelineBacklog
        backlog={backlog}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows "→ Add to queue" button and calls onAddToQueue when clicked', () => {
    const task = makeTask({ id: 'b1', title: 'Queue Me' })
    render(
      <PipelineBacklog
        backlog={[task]}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    const btn = screen.getByRole('button', { name: /add to queue/i })
    fireEvent.click(btn)
    expect(onAddToQueue).toHaveBeenCalledWith(task)
    expect(onTaskClick).not.toHaveBeenCalled()
  })

  it('calls onTaskClick when backlog card is clicked', () => {
    const task = makeTask({ id: 'b1', title: 'Clickable Task' })
    render(
      <PipelineBacklog
        backlog={[task]}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    fireEvent.click(screen.getByText('Clickable Task'))
    expect(onTaskClick).toHaveBeenCalledWith('b1')
  })

  it('renders failed tasks when present', () => {
    const failed = [makeTask({ id: 'f1', title: 'Failed Task', status: 'failed', notes: 'Something went wrong' })]
    render(
      <PipelineBacklog
        backlog={[]}
        failed={failed}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('Failed Task')).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('hides failed section when no failed tasks', () => {
    render(
      <PipelineBacklog
        backlog={[]}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument()
  })

  it('shows "No backlog tasks" when backlog is empty', () => {
    render(
      <PipelineBacklog
        backlog={[]}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('No backlog tasks')).toBeInTheDocument()
  })

  it('shows "↻ Re-run" button on failed cards and calls onRerun when clicked', () => {
    const task = makeTask({ id: 'f1', title: 'Rerun Me', status: 'failed' })
    render(
      <PipelineBacklog
        backlog={[]}
        failed={[task]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    const btn = screen.getByRole('button', { name: /re-run/i })
    fireEvent.click(btn)
    expect(onRerun).toHaveBeenCalledWith(task)
    expect(onTaskClick).not.toHaveBeenCalled()
  })

  it('shows priority badge for high-priority backlog tasks', () => {
    const task = makeTask({ id: 'b1', title: 'High Priority', priority: 1 })
    render(
      <PipelineBacklog
        backlog={[task]}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('P1')).toBeInTheDocument()
  })

  it('shows notes excerpt on failed card', () => {
    const notes = 'Detailed failure reason that is longer than forty chars and more'
    const task = makeTask({ id: 'f1', title: 'Failed', status: 'failed', notes })
    render(
      <PipelineBacklog
        backlog={[]}
        failed={[task]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    // Should show full notes with tooltip
    expect(screen.getByText(notes)).toBeInTheDocument()
    expect(screen.getByTitle(notes)).toBeInTheDocument()
  })

  it('shows "No details" on failed card with no notes', () => {
    const task = makeTask({ id: 'f1', title: 'Failed', status: 'failed', notes: null })
    render(
      <PipelineBacklog
        backlog={[]}
        failed={[task]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('No details')).toBeInTheDocument()
  })
})

describe('PipelineBacklog - additional coverage', () => {
  const onTaskClick = vi.fn()
  const onAddToQueue = vi.fn()
  const onRerun = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows P2 priority badge for priority 2 backlog tasks', () => {
    const task = makeTask({ id: 'b1', title: 'Med Priority', priority: 2 })
    render(
      <PipelineBacklog
        backlog={[task]}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('P2')).toBeInTheDocument()
  })

  it('does not show priority badge for priority 3 backlog tasks', () => {
    const task = makeTask({ id: 'b1', title: 'Low Priority', priority: 3 })
    render(
      <PipelineBacklog
        backlog={[task]}
        failed={[]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.queryByText('P3')).not.toBeInTheDocument()
  })

  it('shows failed count badge', () => {
    const failed = [
      makeTask({ id: 'f1', status: 'failed' }),
      makeTask({ id: 'f2', status: 'failed' })
    ]
    render(
      <PipelineBacklog
        backlog={[]}
        failed={failed}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calls onTaskClick when failed card is clicked', () => {
    const task = makeTask({ id: 'f1', title: 'Clickable Failed', status: 'failed' })
    render(
      <PipelineBacklog
        backlog={[]}
        failed={[task]}
        onTaskClick={onTaskClick}
        onAddToQueue={onAddToQueue}
        onRerun={onRerun}
      />
    )
    fireEvent.click(screen.getByText('Clickable Failed'))
    expect(onTaskClick).toHaveBeenCalledWith('f1')
  })
})
