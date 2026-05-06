import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineGlanceCard } from '../PipelineGlanceCard'
import { buildStageCells } from '../pipeline-glance-cells'
import type { SprintPartition } from '../../../../lib/partitionSprintTasks'
import type { DashboardStats } from '../../../../lib/dashboard-types'
import type { SprintTask } from '../../../../../../shared/types'
import { nowIso } from '../../../../../../shared/time'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'fleet',
    prompt: null,
    priority: 1,
    status: 'active',
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

function makePartition(overrides: Partial<SprintPartition> = {}): SprintPartition {
  return {
    backlog: [],
    todo: [],
    blocked: [],
    inProgress: [],
    pendingReview: [],
    approved: [],
    openPrs: [],
    done: [],
    failed: [],
    ...overrides
  }
}

function makeStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    active: 0,
    queued: 0,
    blocked: 0,
    review: 0,
    done: 0,
    doneToday: 0,
    failed: 0,
    actualFailed: 0,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// buildStageCells unit tests
// ---------------------------------------------------------------------------

describe('buildStageCells', () => {
  it('shows "none active" peek text when inProgress is empty', () => {
    const cells = buildStageCells(makePartition(), makeStats())
    const running = cells.find((c) => c.key === 'running')
    expect(running?.peek).toBe('none active')
  })

  it('shows oldest active task title in running peek when inProgress has tasks', () => {
    const first = makeTask({ title: 'First started', started_at: new Date(Date.now() - 5000).toISOString() })
    const last = makeTask({ title: 'Last (oldest in array)', started_at: new Date(Date.now() - 1000).toISOString() })
    // buildStageCells uses the last element as "oldest" (conventional ordering: first task = most recent)
    const cells = buildStageCells(makePartition({ inProgress: [first, last] }), makeStats())
    const running = cells.find((c) => c.key === 'running')
    expect(running?.peek).toContain('Last (oldest in array)')
  })

  it('shows "queue is empty" peek text when todo is empty', () => {
    const cells = buildStageCells(makePartition(), makeStats())
    const queued = cells.find((c) => c.key === 'queued')
    expect(queued?.peek).toBe('queue is empty')
  })

  it('shows next task title in queued peek when todo is non-empty', () => {
    const task = makeTask({ title: 'Next up', status: 'queued' })
    const cells = buildStageCells(makePartition({ todo: [task] }), makeStats())
    const queued = cells.find((c) => c.key === 'queued')
    expect(queued?.peek).toContain('Next up')
  })

  it('shows "none pending" peek text when pendingReview is empty', () => {
    const cells = buildStageCells(makePartition(), makeStats())
    const review = cells.find((c) => c.key === 'review')
    expect(review?.peek).toBe('none pending')
  })

  it('shows "+N today" in done peek', () => {
    const cells = buildStageCells(makePartition(), makeStats({ doneToday: 3 }))
    const done = cells.find((c) => c.key === 'done')
    expect(done?.peek).toBe('+3 today')
  })

  it('returns four cells: queued, running, review, done', () => {
    const cells = buildStageCells(makePartition(), makeStats())
    expect(cells.map((c) => c.key)).toEqual(['queued', 'running', 'review', 'done'])
  })
})

// ---------------------------------------------------------------------------
// PipelineGlanceCard render tests
// ---------------------------------------------------------------------------

describe('PipelineGlanceCard', () => {
  it('renders all four stage labels', () => {
    render(
      <PipelineGlanceCard
        partitions={makePartition()}
        stats={makeStats()}
        onOpenPipeline={vi.fn()}
      />
    )
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('shows "none active" when inProgress is empty', () => {
    render(
      <PipelineGlanceCard
        partitions={makePartition()}
        stats={makeStats()}
        onOpenPipeline={vi.fn()}
      />
    )
    expect(screen.getByText('none active')).toBeInTheDocument()
  })

  it('shows oldest active task title when inProgress is non-empty', () => {
    const oldest = makeTask({ title: 'Old runner' })
    render(
      <PipelineGlanceCard
        partitions={makePartition({ inProgress: [makeTask(), oldest] })}
        stats={makeStats()}
        onOpenPipeline={vi.fn()}
      />
    )
    expect(screen.getByText(/Old runner/)).toBeInTheDocument()
  })

  it('shows "queue is empty" when todo is empty', () => {
    render(
      <PipelineGlanceCard
        partitions={makePartition()}
        stats={makeStats()}
        onOpenPipeline={vi.fn()}
      />
    )
    expect(screen.getByText('queue is empty')).toBeInTheDocument()
  })
})
