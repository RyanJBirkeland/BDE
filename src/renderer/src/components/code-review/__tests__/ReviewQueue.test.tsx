import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockSelectTask } = vi.hoisted(() => ({ mockSelectTask: vi.fn() }))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: null,
    selectTask: mockSelectTask
  }))
  return { useCodeReviewStore: store }
})

const { sprintState } = vi.hoisted(() => ({
  sprintState: {
    tasks: [] as Array<Record<string, unknown>>,
    loading: false,
    loadData: vi.fn()
  }
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(sprintState))
}))

import { ReviewQueue } from '../ReviewQueue'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('ReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sprintState.tasks = []
    useCodeReviewStore.setState({ selectedTaskId: null, selectTask: mockSelectTask })
  })

  it('renders empty state when no review tasks', () => {
    render(<ReviewQueue />)
    expect(screen.getByText('No tasks awaiting review')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('renders task list when review tasks exist', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'Fix bug',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      },
      {
        id: 't2',
        title: 'Add feature',
        repo: 'life-os',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      },
      {
        id: 't3',
        title: 'Active task',
        repo: 'bde',
        status: 'active',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    render(<ReviewQueue />)
    expect(screen.getByText('Fix bug')).toBeInTheDocument()
    expect(screen.getByText('Add feature')).toBeInTheDocument()
    expect(screen.queryByText('Active task')).not.toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('clicking a task calls selectTask', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'Fix bug',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    render(<ReviewQueue />)
    fireEvent.click(screen.getByText('Fix bug'))
    expect(mockSelectTask).toHaveBeenCalledWith('t1')
  })

  it('highlights the selected task', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'Fix bug',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewQueue />)
    const button = screen.getByText('Fix bug').closest('button')
    expect(button?.className).toContain('cr-queue__item--selected')
  })

  it('sorts tasks by updated_at descending', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'Older',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-03-01T00:00:00Z'
      },
      {
        id: 't2',
        title: 'Newer',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    render(<ReviewQueue />)
    const items = screen.getAllByRole('button')
    expect(items[0]).toHaveTextContent('Newer')
    expect(items[1]).toHaveTextContent('Older')
  })
})
