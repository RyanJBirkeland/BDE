import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlQueueBar } from '../PlQueueBar'
import type { SprintTask } from '../../../../../../shared/types'
import { nowIso } from '../../../../../../shared/time'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Task',
    repo: 'fleet',
    prompt: null,
    priority: 1,
    status: 'backlog',
    notes: null,
    spec: '## H1\n\nSome content',
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

describe('PlQueueBar', () => {
  it('enables the Send to pipeline button when every task has a spec', () => {
    const tasks = [makeTask(), makeTask()]
    render(
      <PlQueueBar tasks={tasks} isPaused={false} onQueueAll={vi.fn()} onTogglePause={vi.fn()} />
    )
    const button = screen.getByRole('button', { name: /Send to pipeline/ })
    expect(button).not.toBeDisabled()
  })

  it('disables the Send to pipeline button when at least one task has no spec', () => {
    const tasks = [makeTask(), makeTask({ spec: '' })]
    render(
      <PlQueueBar tasks={tasks} isPaused={false} onQueueAll={vi.fn()} onTogglePause={vi.fn()} />
    )
    const button = screen.getByRole('button', { name: /Send to pipeline/ })
    expect(button).toBeDisabled()
  })

  it('disables the Send to pipeline button when there is nothing ready to queue', () => {
    const tasks = [makeTask({ status: 'done', spec: '## h\n\ncontent' })]
    render(
      <PlQueueBar tasks={tasks} isPaused={false} onQueueAll={vi.fn()} onTogglePause={vi.fn()} />
    )
    const button = screen.getByRole('button', { name: /Send to pipeline/ })
    expect(button).toBeDisabled()
  })

  it('invokes onQueueAll when the enabled button is clicked', () => {
    const onQueueAll = vi.fn()
    render(
      <PlQueueBar
        tasks={[makeTask()]}
        isPaused={false}
        onQueueAll={onQueueAll}
        onTogglePause={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Send to pipeline/ }))
    expect(onQueueAll).toHaveBeenCalledTimes(1)
  })

  it('invokes onTogglePause when the pause button is clicked', () => {
    const onTogglePause = vi.fn()
    render(
      <PlQueueBar
        tasks={[makeTask()]}
        isPaused={false}
        onQueueAll={vi.fn()}
        onTogglePause={onTogglePause}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Pause epic/ }))
    expect(onTogglePause).toHaveBeenCalledTimes(1)
  })
})
