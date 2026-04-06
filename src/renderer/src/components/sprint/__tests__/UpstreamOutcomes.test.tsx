import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UpstreamOutcomes } from '../UpstreamOutcomes'
import type { SprintTask } from '../../../../../shared/types'

const makeTask = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  prompt: null,
  priority: 1,
  status: 'done',
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_mergeable_state: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides
})

describe('UpstreamOutcomes', () => {
  it('returns null when no upstream tasks', () => {
    const { container } = render(
      <UpstreamOutcomes upstreamTasks={[]} onNavigate={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders upstream task list', () => {
    const tasks = [makeTask('t1'), makeTask('t2')]
    render(<UpstreamOutcomes upstreamTasks={tasks} onNavigate={vi.fn()} />)
    expect(screen.getByText('Task t1')).toBeInTheDocument()
    expect(screen.getByText('Task t2')).toBeInTheDocument()
  })

  it('calls onNavigate when task is clicked', () => {
    const onNavigate = vi.fn()
    render(
      <UpstreamOutcomes upstreamTasks={[makeTask('t1')]} onNavigate={onNavigate} />
    )
    fireEvent.click(screen.getByText('Task t1'))
    expect(onNavigate).toHaveBeenCalledWith('t1')
  })

  it('shows PR link when available', () => {
    const tasks = [makeTask('t1', { pr_url: 'https://github.com/pr/1', pr_number: 1, pr_status: 'open' })]
    render(<UpstreamOutcomes upstreamTasks={tasks} onNavigate={vi.fn()} />)
    expect(screen.getByText(/PR #1/)).toBeInTheDocument()
  })

  it('shows truncated notes', () => {
    const longNotes = 'A'.repeat(150)
    const tasks = [makeTask('t1', { notes: longNotes })]
    render(<UpstreamOutcomes upstreamTasks={tasks} onNavigate={vi.fn()} />)
    expect(screen.getByText(/A{100}\.\.\./)).toBeInTheDocument()
  })
})
