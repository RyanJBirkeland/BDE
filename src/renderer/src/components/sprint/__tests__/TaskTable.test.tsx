import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskTable } from '../TaskTable'
import type { SprintTask } from '../../../../../shared/types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Fix the login bug',
    repo: 'BDE',
    prompt: null,
    priority: 3,
    status: 'backlog',
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
    updated_at: '2026-01-15T10:00:00Z',
    created_at: '2026-01-10T10:00:00Z',
    ...overrides
  }
}

const defaultProps = {
  section: 'backlog' as const,
  tasks: [],
  onPushToSprint: vi.fn(),
  onViewSpec: vi.fn(),
  onViewOutput: vi.fn()
}

describe('TaskTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear localStorage to avoid persisted collapse state
    localStorage.clear()
  })

  describe('section header', () => {
    it('renders "Backlog" label for backlog section', () => {
      render(<TaskTable {...defaultProps} section="backlog" tasks={[]} />)
      expect(screen.getByText('Backlog')).toBeInTheDocument()
    })

    it('renders "Done" label for done section', () => {
      render(<TaskTable {...defaultProps} section="done" tasks={[]} />)
      expect(screen.getByText('Done')).toBeInTheDocument()
    })

    it('renders "Failed / Cancelled" label for failed section', () => {
      render(<TaskTable {...defaultProps} section="failed" tasks={[]} />)
      expect(screen.getByText(/Failed \/ Cancelled/)).toBeInTheDocument()
    })

    it('shows task count badge', () => {
      const tasks = [makeTask(), makeTask({ id: 'task-2', title: 'Another task' })]
      render(<TaskTable {...defaultProps} tasks={tasks} />)
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('toggles collapsed on header click', () => {
      render(<TaskTable {...defaultProps} tasks={[makeTask()]} />)
      const header = document.querySelector('.bde-task-section__header')!
      // Initially expanded (defaultExpanded=true)
      expect(screen.getByText('Fix the login bug')).toBeInTheDocument()
      fireEvent.click(header)
      expect(screen.queryByText('Fix the login bug')).not.toBeInTheDocument()
    })

    it('persists collapse state to localStorage', () => {
      render(<TaskTable {...defaultProps} section="backlog" tasks={[makeTask()]} />)
      const header = document.querySelector('.bde-task-section__header')!
      fireEvent.click(header) // collapse
      expect(localStorage.getItem('bde-table-backlog-collapsed')).toBe('true')
    })

    it('restores collapsed state from localStorage', () => {
      localStorage.setItem('bde-table-backlog-collapsed', 'true')
      render(<TaskTable {...defaultProps} section="backlog" tasks={[makeTask()]} />)
      // Should be collapsed — task not visible
      expect(screen.queryByText('Fix the login bug')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty message for backlog with no tasks', () => {
      render(<TaskTable {...defaultProps} section="backlog" tasks={[]} />)
      expect(screen.getByText('Backlog is empty')).toBeInTheDocument()
    })

    it('shows empty message for done with no tasks', () => {
      render(<TaskTable {...defaultProps} section="done" tasks={[]} />)
      expect(screen.getByText('No completed tasks')).toBeInTheDocument()
    })

    it('shows empty message for failed with no tasks', () => {
      render(<TaskTable {...defaultProps} section="failed" tasks={[]} />)
      expect(screen.getByText('No failed tasks')).toBeInTheDocument()
    })
  })

  describe('BacklogRow', () => {
    it('renders task title', () => {
      render(<TaskTable {...defaultProps} tasks={[makeTask()]} />)
      expect(screen.getByText('Fix the login bug')).toBeInTheDocument()
    })

    it('renders repo badge', () => {
      render(<TaskTable {...defaultProps} tasks={[makeTask()]} />)
      expect(screen.getByText('BDE')).toBeInTheDocument()
    })

    it('calls onViewSpec when title is clicked', () => {
      const onViewSpec = vi.fn()
      const task = makeTask()
      render(<TaskTable {...defaultProps} tasks={[task]} onViewSpec={onViewSpec} />)
      fireEvent.click(screen.getByText('Fix the login bug'))
      expect(onViewSpec).toHaveBeenCalledWith(task)
    })

    it('renders Sprint button and calls onPushToSprint', () => {
      const onPushToSprint = vi.fn()
      const task = makeTask()
      render(<TaskTable {...defaultProps} tasks={[task]} onPushToSprint={onPushToSprint} />)
      const sprintBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Sprint')
      )!
      expect(sprintBtn).toBeTruthy()
      fireEvent.click(sprintBtn)
      expect(onPushToSprint).toHaveBeenCalledWith(task)
    })

    it('renders Mark Done button when onMarkDone provided', () => {
      const onMarkDone = vi.fn()
      const task = makeTask()
      render(<TaskTable {...defaultProps} tasks={[task]} onMarkDone={onMarkDone} />)
      const markDoneBtn = screen.getByTitle('Mark Done')
      expect(markDoneBtn).toBeInTheDocument()
      fireEvent.click(markDoneBtn)
      expect(onMarkDone).toHaveBeenCalledWith(task)
    })

    it('does not render Mark Done button when onMarkDone not provided', () => {
      render(<TaskTable {...defaultProps} tasks={[makeTask()]} />)
      expect(screen.queryByTitle('Mark Done')).not.toBeInTheDocument()
    })

    it('shows priority popover when priority dot clicked', () => {
      render(<TaskTable {...defaultProps} tasks={[makeTask({ priority: 3 })]} />)
      const priorityDot = document.querySelector('.bde-task-table__priority-dot')!
      fireEvent.click(priorityDot)
      expect(screen.getByText('P1 Critical')).toBeInTheDocument()
      expect(screen.getByText('P3 Medium')).toBeInTheDocument()
    })

    it('calls onUpdate when a different priority option is selected', () => {
      const onUpdate = vi.fn()
      const task = makeTask({ priority: 3, id: 'task-1' })
      render(<TaskTable {...defaultProps} tasks={[task]} onUpdate={onUpdate} />)

      const priorityDot = document.querySelector('.bde-task-table__priority-dot')!
      fireEvent.click(priorityDot)

      fireEvent.click(screen.getByText('P1 Critical'))
      expect(onUpdate).toHaveBeenCalledWith({ id: 'task-1', priority: 1 })
    })

    it('does not call onUpdate when same priority selected', () => {
      const onUpdate = vi.fn()
      const task = makeTask({ priority: 3 })
      render(<TaskTable {...defaultProps} tasks={[task]} onUpdate={onUpdate} />)

      const priorityDot = document.querySelector('.bde-task-table__priority-dot')!
      fireEvent.click(priorityDot)

      fireEvent.click(screen.getByText('P3 Medium'))
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('closes priority popover on outside click', () => {
      render(<TaskTable {...defaultProps} tasks={[makeTask()]} />)
      const priorityDot = document.querySelector('.bde-task-table__priority-dot')!
      fireEvent.click(priorityDot)
      expect(screen.getByText('P1 Critical')).toBeInTheDocument()

      // Click outside
      fireEvent.mouseDown(document.body)
      expect(screen.queryByText('P1 Critical')).not.toBeInTheDocument()
    })
  })

  describe('DoneRow', () => {
    const doneTask = makeTask({
      id: 'done-1',
      title: 'Completed task',
      status: 'done',
      completed_at: '2026-01-20T10:00:00Z'
    })

    it('renders done task title', () => {
      render(<TaskTable {...defaultProps} section="done" tasks={[doneTask]} />)
      expect(screen.getByText('Completed task')).toBeInTheDocument()
    })

    it('shows muted dash when no PR', () => {
      render(<TaskTable {...defaultProps} section="done" tasks={[doneTask]} />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })

    it('shows PR link when pr_url provided', () => {
      const taskWithPr = makeTask({
        id: 'done-pr',
        title: 'PR task',
        status: 'done',
        completed_at: '2026-01-20T10:00:00Z',
        pr_url: 'https://github.com/owner/repo/pull/42',
        pr_number: 42
      })
      render(<TaskTable {...defaultProps} section="done" tasks={[taskWithPr]} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/pull/42')
    })

    it('calls onViewOutput when eye button clicked', () => {
      const onViewOutput = vi.fn()
      render(
        <TaskTable
          {...defaultProps}
          section="done"
          tasks={[doneTask]}
          onViewOutput={onViewOutput}
        />
      )
      fireEvent.click(screen.getByTitle('View Output'))
      expect(onViewOutput).toHaveBeenCalledWith(doneTask)
    })

    it('calls onViewSpec when title clicked', () => {
      const onViewSpec = vi.fn()
      render(
        <TaskTable {...defaultProps} section="done" tasks={[doneTask]} onViewSpec={onViewSpec} />
      )
      fireEvent.click(screen.getByText('Completed task'))
      expect(onViewSpec).toHaveBeenCalledWith(doneTask)
    })

    it('shows Re-run button for done task without PR when onRerun provided', () => {
      const onRerun = vi.fn()
      render(<TaskTable {...defaultProps} section="done" tasks={[doneTask]} onRerun={onRerun} />)
      const rerunBtn = screen.getByTitle('Re-run')
      expect(rerunBtn).toBeInTheDocument()
      fireEvent.click(rerunBtn)
      expect(onRerun).toHaveBeenCalledWith(doneTask)
    })

    it('does not show Re-run button for task with PR', () => {
      const onRerun = vi.fn()
      const taskWithPr = makeTask({
        status: 'done',
        pr_url: 'https://github.com/owner/repo/pull/1',
        pr_number: 1,
        completed_at: '2026-01-20T10:00:00Z'
      })
      render(<TaskTable {...defaultProps} section="done" tasks={[taskWithPr]} onRerun={onRerun} />)
      expect(screen.queryByTitle('Re-run')).not.toBeInTheDocument()
    })
  })

  describe('FailedRow', () => {
    const failedTask = makeTask({
      id: 'failed-1',
      title: 'Failed task',
      status: 'failed',
      updated_at: '2026-01-18T10:00:00Z'
    })

    it('renders failed task title', () => {
      render(<TaskTable {...defaultProps} section="failed" tasks={[failedTask]} />)
      expect(screen.getByText('Failed task')).toBeInTheDocument()
    })

    it('shows Retry button and calls onPushToSprint', () => {
      const onPushToSprint = vi.fn()
      render(
        <TaskTable
          {...defaultProps}
          section="failed"
          tasks={[failedTask]}
          onPushToSprint={onPushToSprint}
        />
      )
      const retryBtn = screen.getByTitle(/Retry/i)
      expect(retryBtn).toBeInTheDocument()
      fireEvent.click(retryBtn)
      expect(onPushToSprint).toHaveBeenCalledWith(failedTask)
    })

    it('calls onViewOutput when eye button clicked', () => {
      const onViewOutput = vi.fn()
      render(
        <TaskTable
          {...defaultProps}
          section="failed"
          tasks={[failedTask]}
          onViewOutput={onViewOutput}
        />
      )
      fireEvent.click(screen.getByTitle('View Output'))
      expect(onViewOutput).toHaveBeenCalledWith(failedTask)
    })

    it('calls onViewSpec when title clicked', () => {
      const onViewSpec = vi.fn()
      render(
        <TaskTable
          {...defaultProps}
          section="failed"
          tasks={[failedTask]}
          onViewSpec={onViewSpec}
        />
      )
      fireEvent.click(screen.getByText('Failed task'))
      expect(onViewSpec).toHaveBeenCalledWith(failedTask)
    })
  })

  describe('row limiting', () => {
    it('shows only defaultRowLimit rows initially for done section', () => {
      const tasks = Array.from({ length: 15 }, (_, i) =>
        makeTask({
          id: `task-${i}`,
          title: `Task ${i}`,
          completed_at: `2026-01-${(i + 1).toString().padStart(2, '0')}T10:00:00Z`
        })
      )
      render(<TaskTable {...defaultProps} section="done" tasks={tasks} defaultRowLimit={10} />)
      // Should show "Show 5 more →"
      expect(screen.getByText(/Show 5 more/)).toBeInTheDocument()
    })

    it('shows all rows after clicking show more', () => {
      const tasks = Array.from({ length: 15 }, (_, i) =>
        makeTask({
          id: `task-${i}`,
          title: `Task ${i}`,
          completed_at: `2026-01-${(i + 1).toString().padStart(2, '0')}T10:00:00Z`
        })
      )
      render(<TaskTable {...defaultProps} section="done" tasks={tasks} defaultRowLimit={10} />)
      fireEvent.click(screen.getByText(/Show 5 more/))
      expect(screen.queryByText(/Show.*more/)).not.toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('sorts backlog tasks by priority', () => {
      const tasks = [
        makeTask({ id: 't1', title: 'Low prio', priority: 5 }),
        makeTask({ id: 't2', title: 'High prio', priority: 1 }),
        makeTask({ id: 't3', title: 'Mid prio', priority: 3 })
      ]
      render(<TaskTable {...defaultProps} tasks={tasks} />)
      const rows = document.querySelectorAll('tbody tr')
      expect(rows[0].textContent).toContain('High prio')
      expect(rows[1].textContent).toContain('Mid prio')
      expect(rows[2].textContent).toContain('Low prio')
    })

    it('sorts done tasks by completed_at descending', () => {
      const tasks = [
        makeTask({
          id: 't1',
          title: 'Older task',
          status: 'done',
          completed_at: '2026-01-10T10:00:00Z'
        }),
        makeTask({
          id: 't2',
          title: 'Newer task',
          status: 'done',
          completed_at: '2026-01-20T10:00:00Z'
        })
      ]
      render(<TaskTable {...defaultProps} section="done" tasks={tasks} />)
      const rows = document.querySelectorAll('tbody tr')
      expect(rows[0].textContent).toContain('Newer task')
      expect(rows[1].textContent).toContain('Older task')
    })
  })
})
