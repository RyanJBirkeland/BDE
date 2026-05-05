import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewQueueCard } from '../ReviewQueueCard'
import type { SprintTask } from '../../../../../../shared/types'
import { nowIso } from '../../../../../../shared/time'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Review me',
    repo: 'fleet',
    prompt: null,
    priority: 1,
    status: 'review',
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

describe('ReviewQueueCard', () => {
  it('shows "All caught up." when there are no tasks', () => {
    render(<ReviewQueueCard tasks={[]} onOpenReview={vi.fn()} />)
    expect(screen.getByText('All caught up.')).toBeInTheDocument()
  })

  it('renders the View all overflow indicator when more than the cap exists', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask({ id: `t${i}`, title: `Task ${i}` }))
    render(<ReviewQueueCard tasks={tasks} onOpenReview={vi.fn()} />)
    expect(screen.getByText('View all (6) →')).toBeInTheDocument()
  })

  it('does not render an overflow indicator when at or below the cap', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => makeTask({ id: `t${i}`, title: `Task ${i}` }))
    render(<ReviewQueueCard tasks={tasks} onOpenReview={vi.fn()} />)
    expect(screen.queryByText(/View all/)).toBeNull()
  })
})
