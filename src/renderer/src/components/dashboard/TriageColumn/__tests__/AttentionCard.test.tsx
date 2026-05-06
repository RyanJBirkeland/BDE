import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttentionCard } from '../AttentionCard'
import type { AttentionItem } from '../../hooks/useDashboardData'
import type { SprintTask } from '../../../../../../shared/types'
import { nowIso } from '../../../../../../shared/time'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'fleet',
    prompt: null,
    priority: 1,
    status: 'failed',
    notes: null,
    spec: null,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    pr_url: null,
    stacked_on_task_id: null,
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

function makeItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    kind: 'failed',
    task: makeTask(),
    ageMs: 60_000,
    sub: 'unknown failure',
    action: 'Restart',
    ...overrides
  }
}

const defaultProps = {
  items: [makeItem()],
  totalCount: 1,
  onOpenPipeline: vi.fn(),
  onOpenReview: vi.fn(),
  onRetryTask: vi.fn().mockResolvedValue(undefined)
}

describe('AttentionCard', () => {
  it('renders null when items array is empty', () => {
    const { container } = render(
      <AttentionCard
        items={[]}
        totalCount={0}
        onOpenPipeline={vi.fn()}
        onOpenReview={vi.fn()}
        onRetryTask={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows item count badge in card head', () => {
    const items = [makeItem(), makeItem()]
    render(<AttentionCard {...defaultProps} items={items} totalCount={2} />)
    expect(screen.getByText('2 need you')).toBeInTheDocument()
  })

  it('calls onRetryTask when Restart button is clicked for a failed item', async () => {
    const onRetryTask = vi.fn().mockResolvedValue(undefined)
    const task = makeTask({ id: 'task-abc', title: 'Failed job' })
    const item = makeItem({ kind: 'failed', task, action: 'Restart' })
    render(
      <AttentionCard
        items={[item]}
        totalCount={1}
        onOpenPipeline={vi.fn()}
        onOpenReview={vi.fn()}
        onRetryTask={onRetryTask}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Restart/i }))
    expect(onRetryTask).toHaveBeenCalledWith('task-abc')
  })

  it('calls onOpenReview when Review button is clicked for a review item', async () => {
    const onOpenReview = vi.fn()
    const item = makeItem({ kind: 'review', action: 'Review' })
    render(
      <AttentionCard
        items={[item]}
        totalCount={1}
        onOpenPipeline={vi.fn()}
        onOpenReview={onOpenReview}
        onRetryTask={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Review/i }))
    expect(onOpenReview).toHaveBeenCalled()
  })

  it('calls onOpenPipeline when Ping button is clicked for a blocked item', async () => {
    const onOpenPipeline = vi.fn()
    const item = makeItem({ kind: 'blocked', action: 'Ping' })
    render(
      <AttentionCard
        items={[item]}
        totalCount={1}
        onOpenPipeline={onOpenPipeline}
        onOpenReview={vi.fn()}
        onRetryTask={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Ping/i }))
    expect(onOpenPipeline).toHaveBeenCalled()
  })

  it('shows "View all" button when totalCount exceeds displayed items', () => {
    const item = makeItem()
    render(
      <AttentionCard
        items={[item]}
        totalCount={10}
        onOpenPipeline={vi.fn()}
        onOpenReview={vi.fn()}
        onRetryTask={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /View all \(10\)/i })).toBeInTheDocument()
  })

  it('does not show "View all" when totalCount equals item count', () => {
    const items = [makeItem(), makeItem()]
    render(<AttentionCard {...defaultProps} items={items} totalCount={2} />)
    expect(screen.queryByText(/View all/)).not.toBeInTheDocument()
  })
})
