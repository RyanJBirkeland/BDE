import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockSelectTask, mockToggleBatchId, mockSelectAllBatch, mockClearBatch } = vi.hoisted(
  () => ({
    mockSelectTask: vi.fn(),
    mockToggleBatchId: vi.fn(),
    mockSelectAllBatch: vi.fn(),
    mockClearBatch: vi.fn()
  })
)

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: null,
    selectTask: mockSelectTask,
    selectedBatchIds: new Set<string>(),
    toggleBatchId: mockToggleBatchId,
    selectAllBatch: mockSelectAllBatch,
    clearBatch: mockClearBatch
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
    useCodeReviewStore.setState({
      selectedTaskId: null,
      selectTask: mockSelectTask,
      selectedBatchIds: new Set(),
      toggleBatchId: mockToggleBatchId,
      selectAllBatch: mockSelectAllBatch,
      clearBatch: mockClearBatch
    })
  })

  it('renders empty state when no review tasks', () => {
    render(<ReviewQueue />)
    expect(
      screen.getByText(
        'No tasks awaiting review. Complete agent runs will appear here for inspection.'
      )
    ).toBeInTheDocument()
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

  it('j key selects next task in queue', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'First',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      },
      {
        id: 't2',
        title: 'Second',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewQueue />)
    fireEvent.keyDown(document, { key: 'j' })
    expect(mockSelectTask).toHaveBeenCalledWith('t2')
  })

  it('k key selects previous task in queue', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'First',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      },
      {
        id: 't2',
        title: 'Second',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't2' })
    render(<ReviewQueue />)
    fireEvent.keyDown(document, { key: 'k' })
    expect(mockSelectTask).toHaveBeenCalledWith('t1')
  })

  it('j key selects first task when none selected', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'First',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      },
      {
        id: 't2',
        title: 'Second',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    useCodeReviewStore.setState({ selectedTaskId: null })
    render(<ReviewQueue />)
    fireEvent.keyDown(document, { key: 'j' })
    expect(mockSelectTask).toHaveBeenCalledWith('t1')
  })

  it('j/k do nothing when review queue is empty', () => {
    sprintState.tasks = []
    render(<ReviewQueue />)
    fireEvent.keyDown(document, { key: 'j' })
    fireEvent.keyDown(document, { key: 'k' })
    expect(mockSelectTask).not.toHaveBeenCalled()
  })

  it('j/k do not fire when typing in an input', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'First',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      }
    ]
    render(<ReviewQueue />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'j', target: input })
    expect(mockSelectTask).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('j does not go past the last task', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'First',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      },
      {
        id: 't2',
        title: 'Second',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't2' })
    render(<ReviewQueue />)
    fireEvent.keyDown(document, { key: 'j' })
    expect(mockSelectTask).toHaveBeenCalledWith('t2')
  })

  it('k does not go before the first task', () => {
    sprintState.tasks = [
      {
        id: 't1',
        title: 'First',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      },
      {
        id: 't2',
        title: 'Second',
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-01T00:00:00Z'
      }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewQueue />)
    fireEvent.keyDown(document, { key: 'k' })
    expect(mockSelectTask).toHaveBeenCalledWith('t1')
  })

  it('renders checkboxes for each review task', () => {
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
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2) // 1 select-all + 1 task checkbox
  })

  it('clicking checkbox toggles batch selection', () => {
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
    const checkboxes = screen.getAllByRole('checkbox')
    // Skip first checkbox (select all), click second (task checkbox)
    fireEvent.click(checkboxes[1])
    expect(mockToggleBatchId).toHaveBeenCalledWith('t1')
  })

  it('select all checkbox selects all review tasks', () => {
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
        repo: 'bde',
        status: 'review',
        updated_at: '2026-04-02T00:00:00Z'
      }
    ]
    render(<ReviewQueue />)
    const checkboxes = screen.getAllByRole('checkbox')
    // First checkbox is select-all
    fireEvent.click(checkboxes[0])
    expect(mockSelectAllBatch).toHaveBeenCalledWith(['t2', 't1']) // sorted by updated_at desc
  })
})
