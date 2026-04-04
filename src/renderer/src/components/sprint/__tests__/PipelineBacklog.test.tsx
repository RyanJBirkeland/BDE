import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineBacklog } from '../PipelineBacklog'
import type { SprintTask } from '../../../../../shared/types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    prompt: '',
    repo: 'bde',
    status: 'backlog',
    priority: 3,
    depends_on: [],
    spec: null,
    notes: null,
    pr_url: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    agent_run_id: null,
    retry_count: 0,
    fast_fail_count: 0,
    started_at: null,
    completed_at: null,
    claimed_by: null,
    template_name: null,
    playground_enabled: false,
    needs_review: false,
    max_runtime_ms: null,
    spec_type: null,
    worktree_path: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  }
}

describe('PipelineBacklog', () => {
  const onTaskClick = vi.fn()
  const onAddToQueue = vi.fn()
  const onRerun = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('backlog cards', () => {
    it('renders backlog card without role="button" on the outer div', () => {
      const task = makeTask({ id: 'b-1', title: 'Backlog Task' })
      render(
        <PipelineBacklog
          backlog={[task]}
          failed={[]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const card = screen.getByTestId('backlog-card-b-1')
      expect(card).not.toHaveAttribute('role', 'button')
    })

    it('renders at least 2 separate buttons per backlog card (select + action)', () => {
      const task = makeTask({ id: 'b-1', title: 'Backlog Task' })
      render(
        <PipelineBacklog
          backlog={[task]}
          failed={[]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const card = screen.getByTestId('backlog-card-b-1')
      const buttons = card.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
    })

    it('clicking the select button calls onTaskClick with the task id', () => {
      const task = makeTask({ id: 'b-1', title: 'Backlog Task' })
      render(
        <PipelineBacklog
          backlog={[task]}
          failed={[]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const selectBtn = screen.getByRole('button', { name: /select task: backlog task/i })
      fireEvent.click(selectBtn)
      expect(onTaskClick).toHaveBeenCalledWith('b-1')
    })

    it('clicking the action button calls onAddToQueue with the task', () => {
      const task = makeTask({ id: 'b-1', title: 'Backlog Task' })
      render(
        <PipelineBacklog
          backlog={[task]}
          failed={[]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const addBtn = screen.getByRole('button', { name: /add to queue/i })
      fireEvent.click(addBtn)
      expect(onAddToQueue).toHaveBeenCalledWith(task)
      expect(onTaskClick).not.toHaveBeenCalled()
    })

    it('select button does not trigger action button handler', () => {
      const task = makeTask({ id: 'b-1', title: 'Backlog Task' })
      render(
        <PipelineBacklog
          backlog={[task]}
          failed={[]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const selectBtn = screen.getByRole('button', { name: /select task: backlog task/i })
      fireEvent.click(selectBtn)
      expect(onAddToQueue).not.toHaveBeenCalled()
    })
  })

  describe('failed cards', () => {
    it('renders failed card without role="button" on the outer div', () => {
      const task = makeTask({ id: 'f-1', title: 'Failed Task', status: 'failed' })
      render(
        <PipelineBacklog
          backlog={[]}
          failed={[task]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const card = screen.getByTestId('failed-card-f-1')
      expect(card).not.toHaveAttribute('role', 'button')
    })

    it('renders at least 2 separate buttons per failed card (select + rerun)', () => {
      const task = makeTask({ id: 'f-1', title: 'Failed Task', status: 'failed' })
      render(
        <PipelineBacklog
          backlog={[]}
          failed={[task]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const card = screen.getByTestId('failed-card-f-1')
      const buttons = card.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
    })

    it('clicking the select button on a failed card calls onTaskClick', () => {
      const task = makeTask({ id: 'f-1', title: 'Failed Task', status: 'failed' })
      render(
        <PipelineBacklog
          backlog={[]}
          failed={[task]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const selectBtn = screen.getByRole('button', { name: /select task: failed task/i })
      fireEvent.click(selectBtn)
      expect(onTaskClick).toHaveBeenCalledWith('f-1')
    })

    it('clicking the rerun button calls onRerun with the task', () => {
      const task = makeTask({ id: 'f-1', title: 'Failed Task', status: 'failed' })
      render(
        <PipelineBacklog
          backlog={[]}
          failed={[task]}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      const rerunBtn = screen.getByRole('button', { name: /re-run/i })
      fireEvent.click(rerunBtn)
      expect(onRerun).toHaveBeenCalledWith(task)
      expect(onTaskClick).not.toHaveBeenCalled()
    })
  })

  describe('expand/collapse failed', () => {
    it('shows expand button when there are more than 3 failed tasks', () => {
      const tasks = [1, 2, 3, 4].map((n) =>
        makeTask({ id: `f-${n}`, title: `Failed ${n}`, status: 'failed' })
      )
      render(
        <PipelineBacklog
          backlog={[]}
          failed={tasks}
          onTaskClick={onTaskClick}
          onAddToQueue={onAddToQueue}
          onRerun={onRerun}
        />
      )
      expect(screen.getByText('+1 more...')).toBeInTheDocument()
    })
  })
})
