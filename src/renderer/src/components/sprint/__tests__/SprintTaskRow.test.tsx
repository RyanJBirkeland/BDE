import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SprintTaskRow } from '../SprintTaskRow'
import type { SprintTask } from '../../../../../shared/types'

// Mock icons from lucide-react
vi.mock('lucide-react', () => ({
  ArrowRight: () => <span>ArrowRight</span>,
  Eye: () => <span>Eye</span>,
  CheckCircle2: () => <span>CheckCircle2</span>,
  RefreshCw: () => <span>RefreshCw</span>,
  ExternalLink: () => <span>ExternalLink</span>,
}))

// Mock Badge component
vi.mock('../../ui/Badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant}>
      {children}
    </span>
  ),
}))

describe('SprintTaskRow', () => {
  const mockTask: SprintTask = {
    id: 'task-123',
    title: 'Fix authentication bug',
    repo: 'BDE',
    prompt: 'Fix the auth bug',
    priority: 3,
    status: 'backlog',
    notes: null,
    spec: 'Detailed spec here',
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
    updated_at: '2026-03-20T10:00:00Z',
    created_at: '2026-03-20T10:00:00Z',
  }

  describe('backlog variant', () => {
    it('renders task title', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" />
          </tbody>
        </table>
      )
      expect(screen.getByText('Fix authentication bug')).toBeInTheDocument()
    })

    it('renders repo badge', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" />
          </tbody>
        </table>
      )
      const badge = screen.getByText('BDE')
      expect(badge).toBeInTheDocument()
    })

    it('calls onViewSpec when title is clicked', () => {
      const onViewSpec = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" onViewSpec={onViewSpec} />
          </tbody>
        </table>
      )
      fireEvent.click(screen.getByText('Fix authentication bug'))
      expect(onViewSpec).toHaveBeenCalledWith(mockTask)
    })

    it('shows priority dot', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" />
          </tbody>
        </table>
      )
      const priorityButton = screen.getByLabelText('Priority 3')
      expect(priorityButton).toBeInTheDocument()
    })

    it('calls onPushToSprint when Sprint button is clicked', () => {
      const onPushToSprint = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" onPushToSprint={onPushToSprint} />
          </tbody>
        </table>
      )
      fireEvent.click(screen.getByText('Sprint'))
      expect(onPushToSprint).toHaveBeenCalledWith(mockTask)
    })

    it('calls onMarkDone when Mark Done button is clicked', () => {
      const onMarkDone = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" onMarkDone={onMarkDone} />
          </tbody>
        </table>
      )
      const markDoneButton = screen.getByTitle('Mark Done')
      fireEvent.click(markDoneButton)
      expect(onMarkDone).toHaveBeenCalledWith(mockTask)
    })

    it('calls onEditInWorkbench when Edit button is clicked', () => {
      const onEditInWorkbench = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" onEditInWorkbench={onEditInWorkbench} />
          </tbody>
        </table>
      )
      fireEvent.click(screen.getByText('Edit'))
      expect(onEditInWorkbench).toHaveBeenCalledWith(mockTask)
    })

    it('reflects selected state with aria-selected', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" selected={true} />
          </tbody>
        </table>
      )
      expect(screen.getByRole('row')).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('blocked variant', () => {
    const blockedTask: SprintTask = {
      ...mockTask,
      status: 'blocked',
    }

    it('renders BLOCKED badge', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={blockedTask} variant="blocked" />
          </tbody>
        </table>
      )
      const blockedBadge = screen.getByText('BLOCKED')
      expect(blockedBadge).toBeInTheDocument()
    })

    it('shows priority dot and action buttons', () => {
      const onPushToSprint = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={blockedTask} variant="blocked" onPushToSprint={onPushToSprint} />
          </tbody>
        </table>
      )
      expect(screen.getByLabelText('Priority 3')).toBeInTheDocument()
      expect(screen.getByText('Sprint')).toBeInTheDocument()
    })
  })

  describe('done variant', () => {
    const doneTask: SprintTask = {
      ...mockTask,
      status: 'done',
      completed_at: '2026-03-21T15:30:00Z',
      pr_number: 42,
      pr_url: 'https://github.com/user/repo/pull/42',
    }

    it('renders PR link', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={doneTask} variant="done" />
          </tbody>
        </table>
      )
      const prLink = screen.getByText('#42')
      expect(prLink).toBeInTheDocument()
    })

    it('PR link has correct href', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={doneTask} variant="done" />
          </tbody>
        </table>
      )
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://github.com/user/repo/pull/42')
    })

    it('shows View Output button when handler provided', () => {
      const onViewOutput = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={doneTask} variant="done" onViewOutput={onViewOutput} />
          </tbody>
        </table>
      )
      const viewOutputButton = screen.getByTitle('View Output')
      expect(viewOutputButton).toBeInTheDocument()
      fireEvent.click(viewOutputButton)
      expect(onViewOutput).toHaveBeenCalledWith(doneTask)
    })

    it('shows rerun button for done task without PR', () => {
      const taskWithoutPR = { ...doneTask, pr_url: null, pr_number: null }
      const onRerun = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={taskWithoutPR} variant="done" onRerun={onRerun} />
          </tbody>
        </table>
      )
      const rerunButton = screen.getByTitle('Re-run')
      expect(rerunButton).toBeInTheDocument()
      fireEvent.click(rerunButton)
      expect(onRerun).toHaveBeenCalledWith(taskWithoutPR)
    })

    it('does not show rerun button for done task with PR', () => {
      const onRerun = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={doneTask} variant="done" onRerun={onRerun} />
          </tbody>
        </table>
      )
      expect(screen.queryByTitle('Re-run')).not.toBeInTheDocument()
    })
  })

  describe('failed variant', () => {
    const failedTask: SprintTask = {
      ...mockTask,
      status: 'failed',
    }

    it('renders failed task with dimmed prop', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={failedTask} variant="failed" dimmed={true} />
          </tbody>
        </table>
      )
      const row = screen.getByRole('row')
      expect(row).toHaveAttribute('data-dimmed', 'true')
    })

    it('shows Retry button for failed tasks', () => {
      const onPushToSprint = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={failedTask} variant="failed" onPushToSprint={onPushToSprint} />
          </tbody>
        </table>
      )
      const retryButton = screen.getByText('Retry')
      expect(retryButton).toBeInTheDocument()
      fireEvent.click(retryButton)
      expect(onPushToSprint).toHaveBeenCalledWith(failedTask)
    })
  })

  describe('priority popover', () => {
    it('opens priority popover when priority dot is clicked', () => {
      const onUpdatePriority = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" onUpdatePriority={onUpdatePriority} />
          </tbody>
        </table>
      )
      const priorityDot = screen.getByLabelText('Priority 3')
      fireEvent.click(priorityDot)

      // Check that popover options are visible
      expect(screen.getByText('P1 Critical')).toBeInTheDocument()
      expect(screen.getByText('P2 High')).toBeInTheDocument()
      expect(screen.getByText('P3 Medium')).toBeInTheDocument()
      expect(screen.getByText('P4 Low')).toBeInTheDocument()
      expect(screen.getByText('P5 Backlog')).toBeInTheDocument()
    })

    it('calls onUpdatePriority when new priority is selected', () => {
      const onUpdatePriority = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" onUpdatePriority={onUpdatePriority} />
          </tbody>
        </table>
      )

      // Open popover
      const priorityDot = screen.getByLabelText('Priority 3')
      fireEvent.click(priorityDot)

      // Click P1
      fireEvent.click(screen.getByText('P1 Critical'))

      expect(onUpdatePriority).toHaveBeenCalledWith({ id: 'task-123', priority: 1 })
    })

    it('does not open popover when onUpdatePriority is not provided', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow task={mockTask} variant="backlog" />
          </tbody>
        </table>
      )

      const priorityDot = screen.getByLabelText('Priority 3')
      fireEvent.click(priorityDot)

      // Popover should not appear
      expect(screen.queryByText('P1 Critical')).not.toBeInTheDocument()
    })
  })

  describe('action button visibility', () => {
    it('only shows provided action handlers', () => {
      render(
        <table>
          <tbody>
            <SprintTaskRow
              task={mockTask}
              variant="backlog"
              onViewOutput={vi.fn()}
            />
          </tbody>
        </table>
      )

      // Should show View Output
      expect(screen.getByTitle('View Output')).toBeInTheDocument()

      // Should NOT show Sprint, Mark Done, or Edit buttons
      expect(screen.queryByText('Sprint')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Mark Done')).not.toBeInTheDocument()
      expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    })
  })

  describe('custom onClick handler', () => {
    it('calls custom onClick when provided instead of onViewSpec', () => {
      const onClick = vi.fn()
      const onViewSpec = vi.fn()
      render(
        <table>
          <tbody>
            <SprintTaskRow
              task={mockTask}
              variant="backlog"
              onClick={onClick}
              onViewSpec={onViewSpec}
            />
          </tbody>
        </table>
      )

      fireEvent.click(screen.getByText('Fix authentication bug'))

      expect(onClick).toHaveBeenCalledWith(mockTask)
      expect(onViewSpec).not.toHaveBeenCalled()
    })
  })
})
