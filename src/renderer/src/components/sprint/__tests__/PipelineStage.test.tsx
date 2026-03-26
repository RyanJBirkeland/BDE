import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, className, onClick, 'data-testid': testId, ...rest }: any) => (
      <div className={className} onClick={onClick} data-testid={testId} {...rest}>
        {children}
      </div>
    )
  }
}))

const makeTask = (overrides: Partial<SprintTask> = {}): SprintTask => ({
  id: 'task-1',
  title: 'Test task',
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
  created_at: '2026-03-01T00:00:00Z',
  ...overrides
})

describe('PipelineStage', () => {
  it('renders the stage label', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    render(
      <PipelineStage
        name="queued"
        label="Queued"
        tasks={[]}
        count="0 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })

  it('renders the task count string', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    render(
      <PipelineStage
        name="queued"
        label="Queued"
        tasks={[]}
        count="3 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(screen.getByText('3 tasks')).toBeInTheDocument()
  })

  it('renders "2 of 5" count format', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    render(
      <PipelineStage
        name="done"
        label="Done"
        tasks={[]}
        count="2 of 5"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(screen.getByText('2 of 5')).toBeInTheDocument()
  })

  it('applies the correct dot class based on name', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    const { container } = render(
      <PipelineStage
        name="queued"
        label="Queued"
        tasks={[]}
        count="0 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(container.querySelector('.pipeline-stage__dot--queued')).toBeInTheDocument()
  })

  it('applies blocked dot class for blocked stage', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    const { container } = render(
      <PipelineStage
        name="blocked"
        label="Blocked"
        tasks={[]}
        count="0 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(container.querySelector('.pipeline-stage__dot--blocked')).toBeInTheDocument()
  })

  it('renders a TaskPill for each task', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    const tasks = [
      makeTask({ id: 'task-1', title: 'First task' }),
      makeTask({ id: 'task-2', title: 'Second task' }),
      makeTask({ id: 'task-3', title: 'Third task' })
    ]
    render(
      <PipelineStage
        name="queued"
        label="Queued"
        tasks={tasks}
        count="3 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(screen.getAllByTestId('task-pill')).toHaveLength(3)
    expect(screen.getByText('First task')).toBeInTheDocument()
    expect(screen.getByText('Second task')).toBeInTheDocument()
    expect(screen.getByText('Third task')).toBeInTheDocument()
  })

  it('renders doneFooter when provided', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    render(
      <PipelineStage
        name="done"
        label="Done"
        tasks={[]}
        count="0 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
        doneFooter={<div data-testid="done-footer">Show all</div>}
      />
    )
    expect(screen.getByTestId('done-footer')).toBeInTheDocument()
  })

  it('does not render doneFooter when not provided', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    render(
      <PipelineStage
        name="queued"
        label="Queued"
        tasks={[]}
        count="0 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(screen.queryByTestId('done-footer')).not.toBeInTheDocument()
  })

  it('shows task count in the dot', async () => {
    const { PipelineStage } = await import('../PipelineStage')
    const tasks = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })]
    const { container } = render(
      <PipelineStage
        name="active"
        label="Active"
        tasks={tasks}
        count="2 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    const dot = container.querySelector('.pipeline-stage__dot')
    expect(dot?.textContent).toBe('2')
  })
})
