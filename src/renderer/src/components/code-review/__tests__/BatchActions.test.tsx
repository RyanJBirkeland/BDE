import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockClearBatch = vi.fn()
const mockLoadData = vi.fn()

vi.mock('../../../stores/codeReview', () => ({
  useCodeReviewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      selectedBatchIds: new Set(['task-1', 'task-2']),
      clearBatch: mockClearBatch
    })
  )
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      tasks: [
        { id: 'task-1', title: 'Task 1', status: 'review' },
        { id: 'task-2', title: 'Task 2', status: 'review' },
        { id: 'task-3', title: 'Task 3', status: 'active' }
      ],
      loadData: mockLoadData
    })
  )
}))

vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

import { BatchActions } from '../BatchActions'

describe('BatchActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows selected count', () => {
    render(<BatchActions />)
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('shows Merge All button', () => {
    render(<BatchActions />)
    expect(screen.getByText('Merge All')).toBeInTheDocument()
  })

  it('shows Clear button', () => {
    render(<BatchActions />)
    expect(screen.getByText('Clear')).toBeInTheDocument()
  })

  it('calls clearBatch when Clear is clicked', () => {
    render(<BatchActions />)
    fireEvent.click(screen.getByText('Clear'))
    expect(mockClearBatch).toHaveBeenCalled()
  })

  it('renders the selected count when review tasks are in batch', () => {
    render(<BatchActions />)
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })
})
