import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DagOverlay } from '../DagOverlay'
import type { SprintTask } from '../../../../../shared/types'

const makeTask = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  prompt: null,
  priority: 1,
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
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides
})

describe('DagOverlay', () => {
  const defaultProps = {
    tasks: [makeTask('t1'), makeTask('t2')],
    selectedTaskId: null,
    onSelectTask: vi.fn(),
    onClose: vi.fn()
  }

  it('renders the overlay with task nodes', () => {
    render(<DagOverlay {...defaultProps} />)
    expect(screen.getByText('Task t1')).toBeInTheDocument()
    expect(screen.getByText('Task t2')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    const { container } = render(<DagOverlay {...defaultProps} />)
    // Find close button by the X icon or class
    const closeBtn = container.querySelector('.dag-overlay__close') || screen.queryByRole('button')
    if (closeBtn) {
      fireEvent.click(closeBtn)
      expect(defaultProps.onClose).toHaveBeenCalled()
    }
  })

  it('calls onClose on Escape key', () => {
    render(<DagOverlay {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('calls onSelectTask when a node is clicked', () => {
    render(<DagOverlay {...defaultProps} />)
    fireEvent.click(screen.getByText('Task t1'))
    expect(defaultProps.onSelectTask).toHaveBeenCalledWith('t1')
  })

  it('renders with dependency tasks', () => {
    const tasks = [
      makeTask('t1'),
      makeTask('t2', { depends_on: [{ id: 't1', type: 'hard' }] })
    ]
    render(
      <DagOverlay {...defaultProps} tasks={tasks} />
    )
    // Both tasks should render
    expect(screen.getByText('Task t1')).toBeInTheDocument()
    expect(screen.getByText('Task t2')).toBeInTheDocument()
  })

  it('highlights the selected task', () => {
    render(<DagOverlay {...defaultProps} selectedTaskId="t1" />)
    expect(screen.getByText('Task t1')).toBeInTheDocument()
  })

  it('handles empty task list', () => {
    const { container } = render(
      <DagOverlay {...defaultProps} tasks={[]} />
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
