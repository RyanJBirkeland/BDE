import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SprintTask } from '../../../../../shared/types'
import { nowIso } from '../../../../../shared/time'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>
  },
  useReducedMotion: () => false
}))

vi.mock('../../../lib/motion', () => ({
  SPRINGS: { default: {} }
}))

vi.mock('../../../hooks/useBackoffInterval', () => ({
  useBackoffInterval: vi.fn()
}))

vi.mock('../../../hooks/useNow', () => ({
  useNow: () => Date.now()
}))

vi.mock('../../../stores/sprintSelection', () => ({
  useSprintSelection: vi.fn((sel: any) =>
    sel({ toggleTaskSelection: vi.fn(), clearSelection: vi.fn() })
  )
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector: any) =>
    typeof selector === 'function' ? selector({ tasks: [] }) : { tasks: [] }
  )
}))

vi.mock('../primitives/PriorityChip', () => ({
  PriorityChip: ({ priority }: { priority: number }) => (
    <span data-testid="priority-chip">{priority}</span>
  )
}))

vi.mock('../../ui/Tag', () => ({
  Tag: ({ children }: any) => <span data-testid="tag">{children}</span>
}))

import { TaskPillV2 } from '../TaskPillV2'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'A task',
    repo: 'fleet',
    prompt: null,
    priority: 1,
    status: 'queued',
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

describe('TaskPillV2 contextualRightTag', () => {
  it('shows the PR number when a task has one and is in review', () => {
    const task = makeTask({ status: 'review', pr_number: 42 })
    render(<TaskPillV2 task={task} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('#42')).toBeInTheDocument()
  })

  it('shows the blocking task id snippet when a blocked task has dependencies', () => {
    const task = makeTask({
      status: 'blocked',
      depends_on: [{ id: 'abc1234567890', type: 'hard' }]
    })
    render(<TaskPillV2 task={task} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText(/↳ abc123/)).toBeInTheDocument()
  })

  it('shows the elapsed-time tag for done tasks with a completed_at', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const task = makeTask({ status: 'done', completed_at: past })
    render(<TaskPillV2 task={task} selected={false} onClick={vi.fn()} />)
    // formatElapsed for ~60s renders something like "1m 0s"
    expect(screen.getByText(/m \d+s|^[0-9]+s$/)).toBeInTheDocument()
  })

  it('renders no contextual right tag for an active task with no PR or deps', () => {
    const task = makeTask({ status: 'active', started_at: nowIso() })
    render(<TaskPillV2 task={task} selected={false} onClick={vi.fn()} />)
    // No PR number, no dep tag, no done-elapsed tag
    expect(screen.queryByText(/^#\d+$/)).toBeNull()
    expect(screen.queryByText(/^↳/)).toBeNull()
  })
})
