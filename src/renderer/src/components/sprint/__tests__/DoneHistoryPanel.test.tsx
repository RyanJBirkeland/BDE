import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DoneHistoryPanel } from '../DoneHistoryPanel'
import type { SprintTask } from '../../../../../shared/types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    repo: 'my-repo',
    status: 'done',
    completed_at: '2026-03-20T12:00:00Z',
    description: null,
    spec: null,
    pr_url: null,
    pr_status: null,
    pr_number: null,
    branch: null,
    notes: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-20T12:00:00Z',
    started_at: null,
    depends_on: [],
    claimed_by: null,
    agent_run_id: null,
    priority: 0,
    fast_fail_count: 0,
    max_runtime_ms: null,
    ...overrides
  } as SprintTask
}

function makeProps(overrides: Partial<Parameters<typeof DoneHistoryPanel>[0]> = {}) {
  return {
    tasks: [makeTask({ id: 'task-1', title: 'First Task', repo: 'repo-a' })],
    onTaskClick: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
}

describe('DoneHistoryPanel', () => {
  it('renders title with task count', () => {
    render(<DoneHistoryPanel {...makeProps()} />)
    expect(screen.getByText('Completed Tasks (1)')).toBeInTheDocument()
  })

  it('renders all task titles', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Alpha Task' }),
      makeTask({ id: '2', title: 'Beta Task' }),
      makeTask({ id: '3', title: 'Gamma Task' })
    ]
    render(<DoneHistoryPanel {...makeProps({ tasks })} />)
    expect(screen.getByText('Alpha Task')).toBeInTheDocument()
    expect(screen.getByText('Beta Task')).toBeInTheDocument()
    expect(screen.getByText('Gamma Task')).toBeInTheDocument()
  })

  it('calls onTaskClick with task id when a task row is clicked', () => {
    const props = makeProps()
    render(<DoneHistoryPanel {...props} />)
    fireEvent.click(screen.getByText('First Task'))
    expect(props.onTaskClick).toHaveBeenCalledWith('task-1')
  })

  it('calls onClose when backdrop clicked', () => {
    const props = makeProps()
    render(<DoneHistoryPanel {...props} />)
    const overlay = document.querySelector('.done-history-overlay')
    expect(overlay).toBeTruthy()
    fireEvent.click(overlay!)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('calls onClose when X button clicked', () => {
    const props = makeProps()
    render(<DoneHistoryPanel {...props} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows empty state when no tasks', () => {
    render(<DoneHistoryPanel {...makeProps({ tasks: [] })} />)
    expect(screen.getByText('Completed Tasks (0)')).toBeInTheDocument()
    expect(screen.getByText('No completed tasks yet')).toBeInTheDocument()
  })
})
