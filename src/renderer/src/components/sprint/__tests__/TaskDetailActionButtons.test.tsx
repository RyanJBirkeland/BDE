import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskDetailActionButtons } from '../TaskDetailActionButtons'
import type { SprintTask } from '../../../../../shared/types'
import { nowIso } from '../../../../../shared/time'

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
    updated_at: nowIso(),
    created_at: nowIso(),
    ...overrides
  }
}

describe('TaskDetailActionButtons', () => {
  const mockOnLaunch = vi.fn()
  const mockOnStop = vi.fn()
  const mockOnRerun = vi.fn()
  const mockOnDelete = vi.fn()
  const mockOnViewLogs = vi.fn()
  const mockOnEdit = vi.fn()
  const mockOnUnblock = vi.fn()
  const mockOnRetry = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('backlog status', () => {
    it('renders Launch, Edit, and Delete buttons', () => {
      const task = makeTask({ status: 'backlog' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.getByText('Launch')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('calls onLaunch when Launch is clicked', async () => {
      const task = makeTask({ status: 'backlog' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('Launch'))
      await waitFor(() => expect(mockOnLaunch).toHaveBeenCalledWith(task))
    })

    it('calls onEdit when Edit is clicked', async () => {
      const task = makeTask({ status: 'backlog' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('Edit'))
      await waitFor(() => expect(mockOnEdit).toHaveBeenCalledWith(task))
    })

    it('calls onDelete when Delete is clicked', async () => {
      const task = makeTask({ status: 'backlog' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('Delete'))
      await waitFor(() => expect(mockOnDelete).toHaveBeenCalledWith(task))
    })

    it('disables all buttons during loading', async () => {
      const task = makeTask({ status: 'backlog' })
      let resolve!: () => void
      mockOnLaunch.mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolve = r
          })
      )
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('Launch'))
      const launchButton = screen.getByText('Launch') as HTMLButtonElement
      const editButton = screen.getByText('Edit') as HTMLButtonElement
      const deleteButton = screen.getByText('Delete') as HTMLButtonElement
      expect(launchButton.closest('button')).toBeDisabled()
      expect(editButton.closest('button')).toBeDisabled()
      expect(deleteButton.closest('button')).toBeDisabled()
      resolve()
      await waitFor(() => expect(launchButton.closest('button')).not.toBeDisabled())
    })
  })

  describe('queued status', () => {
    it('renders Launch, Edit, and Delete buttons', () => {
      const task = makeTask({ status: 'queued' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.getByText('Launch')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })
  })

  describe('blocked status', () => {
    it('renders Unblock and Edit buttons', () => {
      const task = makeTask({ status: 'blocked' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.getByText('Unblock')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })

    it('calls onUnblock when provided', async () => {
      const task = makeTask({ status: 'blocked' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
          onUnblock={mockOnUnblock}
        />
      )
      fireEvent.click(screen.getByText('Unblock'))
      await waitFor(() => expect(mockOnUnblock).toHaveBeenCalledWith(task))
    })

    it('calls onLaunch when onUnblock not provided', async () => {
      const task = makeTask({ status: 'blocked' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('Unblock'))
      await waitFor(() => expect(mockOnLaunch).toHaveBeenCalledWith(task))
    })
  })

  describe('active status', () => {
    it('renders View Logs, Edit, and Stop buttons', () => {
      const task = makeTask({ status: 'active' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.getByText('View Logs')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Stop')).toBeInTheDocument()
    })

    it('calls onViewLogs when View Logs is clicked', async () => {
      const task = makeTask({ status: 'active' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('View Logs'))
      await waitFor(() => expect(mockOnViewLogs).toHaveBeenCalledWith(task))
    })

    it('calls onStop when Stop is clicked', async () => {
      const task = makeTask({ status: 'active' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('Stop'))
      await waitFor(() => expect(mockOnStop).toHaveBeenCalledWith(task))
    })
  })

  describe('done status', () => {
    it('renders Clone & Queue button when no PR', () => {
      const task = makeTask({ status: 'done', pr_url: null })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.getByText('Clone & Queue')).toBeInTheDocument()
      expect(screen.queryByText('View PR')).not.toBeInTheDocument()
    })

    it('renders View PR link when pr_url is valid GitHub URL', () => {
      const task = makeTask({
        status: 'done',
        pr_url: 'https://github.com/owner/repo/pull/123'
      })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      const link = screen.getByText('View PR')
      expect(link).toBeInTheDocument()
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/pull/123')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('does not render View PR when pr_url is not GitHub', () => {
      const task = makeTask({
        status: 'done',
        pr_url: 'https://evil.com/malicious'
      })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.queryByText('View PR')).not.toBeInTheDocument()
    })

    it('does not render View PR when pr_url is invalid URL', () => {
      const task = makeTask({
        status: 'done',
        pr_url: 'not-a-url'
      })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.queryByText('View PR')).not.toBeInTheDocument()
    })

    it('calls onRerun when Clone & Queue is clicked', async () => {
      const task = makeTask({ status: 'done' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      fireEvent.click(screen.getByText('Clone & Queue'))
      await waitFor(() => expect(mockOnRerun).toHaveBeenCalledWith(task))
    })
  })

  describe('failed/error/cancelled statuses', () => {
    it('renders Retry button for failed status when onRetry provided', () => {
      const task = makeTask({ status: 'failed' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
          onRetry={mockOnRetry}
        />
      )
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('renders Retry button for error status when onRetry provided', () => {
      const task = makeTask({ status: 'error' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
          onRetry={mockOnRetry}
        />
      )
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('does not render Retry button for cancelled status', () => {
      const task = makeTask({ status: 'cancelled' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
          onRetry={mockOnRetry}
        />
      )
      expect(screen.queryByText('Retry')).not.toBeInTheDocument()
    })

    it('always renders Clone & Queue, Edit, and Delete buttons', () => {
      const task = makeTask({ status: 'failed' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(screen.getByText('Clone & Queue')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('calls onRetry when Retry is clicked', async () => {
      const task = makeTask({ status: 'failed' })
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
          onRetry={mockOnRetry}
        />
      )
      fireEvent.click(screen.getByText('Retry'))
      await waitFor(() => expect(mockOnRetry).toHaveBeenCalledWith(task))
    })
  })

  describe('loading states', () => {
    it('shows spinner with aria-busy during action', async () => {
      const task = makeTask({ status: 'backlog' })
      let resolve!: () => void
      mockOnLaunch.mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolve = r
          })
      )
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      const launchButton = screen.getByText('Launch').closest('button')!
      fireEvent.click(launchButton)
      expect(launchButton).toHaveAttribute('aria-busy', 'true')
      resolve()
      await waitFor(() => expect(launchButton).not.toHaveAttribute('aria-busy', 'true'))
    })

    it('clears loading state after action completes', async () => {
      const task = makeTask({ status: 'backlog' })
      mockOnLaunch.mockResolvedValue(undefined)
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      const launchButton = screen.getByText('Launch').closest('button')!
      fireEvent.click(launchButton)
      await waitFor(() => {
        expect(launchButton).not.toBeDisabled()
      })
    })

    it('clears loading state after action fails', async () => {
      const task = makeTask({ status: 'backlog' })
      mockOnLaunch.mockRejectedValue(new Error('Test error'))
      render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      const launchButton = screen.getByText('Launch').closest('button')!
      fireEvent.click(launchButton)
      await waitFor(() => {
        expect(launchButton).not.toBeDisabled()
      })
    })
  })

  describe('default/unknown status', () => {
    it('renders nothing for unknown status', () => {
      const task = makeTask({ status: 'review' as any })
      const { container } = render(
        <TaskDetailActionButtons
          task={task}
          onLaunch={mockOnLaunch}
          onStop={mockOnStop}
          onRerun={mockOnRerun}
          onDelete={mockOnDelete}
          onViewLogs={mockOnViewLogs}
          onEdit={mockOnEdit}
        />
      )
      expect(container.textContent).toBe('')
    })
  })
})
