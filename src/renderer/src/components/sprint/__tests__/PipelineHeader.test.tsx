import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PipelineHeader } from '../PipelineHeader'
import type { SprintTask } from '../../../../../shared/types'

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
    ...overrides
  }
}

describe('PipelineHeader', () => {
  const defaultStats = [
    { label: 'active', count: 2, filter: 'in-progress' as const },
    { label: 'queued', count: 1, filter: 'todo' as const },
    { label: 'blocked', count: 0, filter: 'blocked' as const },
    { label: 'review', count: 0, filter: 'awaiting-review' as const },
    { label: 'failed', count: 0, filter: 'failed' as const },
    { label: 'done', count: 3, filter: 'done' as const }
  ]

  it('renders title "Task Pipeline"', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.getByText('Task Pipeline')).toBeInTheDocument()
  })

  it('renders all stat badges with correct counts', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('queued')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('done')).toBeInTheDocument()
  })

  it('calls onFilterClick when stat badge is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={mockFilterClick}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    const activeElement = screen.getByText('active').closest('[role="button"]') as HTMLElement
    fireEvent.click(activeElement)
    expect(mockFilterClick).toHaveBeenCalledWith('in-progress')
  })

  it('calls onFilterClick on Enter key press', () => {
    const mockFilterClick = vi.fn()
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={mockFilterClick}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    const queuedElement = screen.getByText('queued').closest('[role="button"]') as HTMLElement
    fireEvent.keyDown(queuedElement, { key: 'Enter' })
    expect(mockFilterClick).toHaveBeenCalledWith('todo')
  })

  it('calls onFilterClick on Space key press', () => {
    const mockFilterClick = vi.fn()
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={mockFilterClick}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    const blockedElement = screen.getByText('blocked').closest('[role="button"]') as HTMLElement
    fireEvent.keyDown(blockedElement, { key: ' ' })
    expect(mockFilterClick).toHaveBeenCalledWith('blocked')
  })

  it('does not render conflict badge when no conflicting tasks', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.queryByLabelText(/merge conflict/)).not.toBeInTheDocument()
  })

  it('renders conflict badge when conflicting tasks exist', () => {
    const conflictingTasks = [makeTask({ id: 'c1' }), makeTask({ id: 'c2' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.getByLabelText('2 merge conflicts')).toBeInTheDocument()
  })

  it('calls onConflictClick when conflict badge is clicked', () => {
    const mockConflictClick = vi.fn()
    const conflictingTasks = [makeTask({ id: 'c1' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={mockConflictClick}
        onHealthCheckClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('1 merge conflict'))
    expect(mockConflictClick).toHaveBeenCalledOnce()
  })

  it('does not render health check badge when no stuck tasks', () => {
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.queryByLabelText(/stuck task/)).not.toBeInTheDocument()
  })

  it('renders health check badge when stuck tasks exist', () => {
    const stuckTasks = [makeTask({ id: 's1' }), makeTask({ id: 's2' }), makeTask({ id: 's3' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={stuckTasks}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.getByLabelText('3 stuck tasks')).toBeInTheDocument()
  })

  it('calls onHealthCheckClick when health check badge is clicked', () => {
    const mockHealthCheckClick = vi.fn()
    const stuckTasks = [makeTask({ id: 's1' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={[]}
        visibleStuckTasks={stuckTasks}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={mockHealthCheckClick}
      />
    )
    fireEvent.click(screen.getByLabelText('1 stuck task'))
    expect(mockHealthCheckClick).toHaveBeenCalledOnce()
  })

  it('renders both conflict and health check badges when both exist', () => {
    const conflictingTasks = [makeTask({ id: 'c1' })]
    const stuckTasks = [makeTask({ id: 's1' })]
    render(
      <PipelineHeader
        stats={defaultStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={stuckTasks}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.getByLabelText('1 merge conflict')).toBeInTheDocument()
    expect(screen.getByLabelText('1 stuck task')).toBeInTheDocument()
  })
})
