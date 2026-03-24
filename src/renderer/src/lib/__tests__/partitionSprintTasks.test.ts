import { describe, it, expect } from 'vitest'
import { partitionSprintTasks } from '../partitionSprintTasks'
import type { SprintTask } from '../../../../shared/types'

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
    ...overrides,
  }
}

describe('partitionSprintTasks', () => {
  it('returns empty arrays when given no tasks', () => {
    const result = partitionSprintTasks([])
    expect(result).toEqual({
      backlog: [],
      todo: [],
      blocked: [],
      inProgress: [],
      awaitingReview: [],
      done: [],
      failed: [],
    })
  })

  it('puts backlog tasks in backlog', () => {
    const t = makeTask({ status: 'backlog' })
    const result = partitionSprintTasks([t])
    expect(result.backlog).toEqual([t])
    expect(result.todo).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
    expect(result.inProgress).toHaveLength(0)
    expect(result.awaitingReview).toHaveLength(0)
    expect(result.done).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it('puts queued tasks in todo', () => {
    const t = makeTask({ status: 'queued' })
    const result = partitionSprintTasks([t])
    expect(result.todo).toEqual([t])
  })

  it('puts active tasks in inProgress', () => {
    const t = makeTask({ status: 'active' })
    const result = partitionSprintTasks([t])
    expect(result.inProgress).toEqual([t])
  })

  it('puts done tasks with pr_status=open in awaitingReview', () => {
    const t = makeTask({ status: 'done', pr_status: 'open', pr_url: 'https://github.com/pr/1' })
    const result = partitionSprintTasks([t])
    expect(result.awaitingReview).toEqual([t])
    expect(result.done).toHaveLength(0)
  })

  it('puts done tasks with pr_status=merged in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'merged' })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
    expect(result.awaitingReview).toHaveLength(0)
  })

  it('puts done tasks with pr_status=closed in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'closed' })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
  })

  it('puts done tasks with pr_status=null in done', () => {
    const t = makeTask({ status: 'done', pr_status: null })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
  })

  it('puts done tasks with pr_status=draft in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'draft' })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
  })

  it('puts blocked tasks into blocked bucket', () => {
    const tasks = [makeTask({ status: 'blocked' })]
    const result = partitionSprintTasks(tasks)
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].status).toBe('blocked')
    expect(result.todo).toHaveLength(0)
  })

  it('puts cancelled tasks in failed', () => {
    const t = makeTask({ status: 'cancelled' })
    const result = partitionSprintTasks([t])
    expect(result.failed).toEqual([t])
    expect(result.done).toHaveLength(0)
  })

  it('correctly partitions a mixed set of tasks', () => {
    const tasks = [
      makeTask({ title: 'B1', status: 'backlog' }),
      makeTask({ title: 'B2', status: 'backlog' }),
      makeTask({ title: 'Q1', status: 'queued' }),
      makeTask({ title: 'A1', status: 'active' }),
      makeTask({ title: 'A2', status: 'active' }),
      makeTask({ title: 'D1', status: 'done', pr_status: 'merged' }),
      makeTask({ title: 'D2', status: 'done', pr_status: null }),
      makeTask({ title: 'R1', status: 'done', pr_status: 'open' }),
      makeTask({ title: 'R2', status: 'done', pr_status: 'open' }),
      makeTask({ title: 'C1', status: 'cancelled' }),
    ]

    const result = partitionSprintTasks(tasks)
    expect(result.backlog).toHaveLength(2)
    expect(result.todo).toHaveLength(1)
    expect(result.inProgress).toHaveLength(2)
    expect(result.done).toHaveLength(2)
    expect(result.awaitingReview).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
  })

  it('every task lands in exactly one bucket (no duplicates)', () => {
    const tasks = [
      makeTask({ status: 'backlog' }),
      makeTask({ status: 'queued' }),
      makeTask({ status: 'active' }),
      makeTask({ status: 'done', pr_status: 'open' }),
      makeTask({ status: 'done', pr_status: 'merged' }),
      makeTask({ status: 'cancelled' }),
    ]

    const result = partitionSprintTasks(tasks)
    const allPartitioned = [
      ...result.backlog,
      ...result.todo,
      ...result.blocked,
      ...result.inProgress,
      ...result.awaitingReview,
      ...result.done,
      ...result.failed,
    ]

    expect(allPartitioned).toHaveLength(tasks.length)
    const ids = allPartitioned.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
