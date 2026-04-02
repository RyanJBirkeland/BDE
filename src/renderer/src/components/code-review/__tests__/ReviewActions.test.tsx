import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

import { ReviewActions } from '../ReviewActions'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('ReviewActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sprintState.tasks = []
    useCodeReviewStore.setState({ selectedTaskId: null, selectTask: mockSelectTask })
  })

  it('shows hint when no task selected', () => {
    render(<ReviewActions />)
    expect(screen.getByText('Select a task in review to see actions')).toBeInTheDocument()
  })

  it('shows hint when selected task is not in review status', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Active task', repo: 'bde', status: 'active', updated_at: '2026-04-01T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewActions />)
    expect(screen.getByText('Select a task in review to see actions')).toBeInTheDocument()
  })

  it('shows all 4 action buttons when review task selected', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Review task', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewActions />)
    expect(screen.getByText('Merge Locally')).toBeInTheDocument()
    expect(screen.getByText('Create PR')).toBeInTheDocument()
    expect(screen.getByText('Revise')).toBeInTheDocument()
    expect(screen.getByText('Discard')).toBeInTheDocument()
  })

  it('renders merge strategy selector defaulting to squash', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Review task', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewActions />)
    const select = screen.getByDisplayValue('Squash')
    expect(select).toBeInTheDocument()
  })

  it('merge button triggers confirm dialog', async () => {
    sprintState.tasks = [
      { id: 't1', title: 'Review task', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewActions />)
    fireEvent.click(screen.getByText('Merge Locally'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('discard button triggers danger confirm', async () => {
    sprintState.tasks = [
      { id: 't1', title: 'Review task', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewActions />)
    fireEvent.click(screen.getByText('Discard'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('create PR calls review.createPr on click', async () => {
    sprintState.tasks = [
      { id: 't1', title: 'Review task', repo: 'bde', status: 'review', spec: '## Spec', updated_at: '2026-04-01T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewActions />)
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => {
      expect(window.api.review.createPr).toHaveBeenCalledWith({
        taskId: 't1',
        title: 'Review task',
        body: '## Spec'
      })
    })
  })
})
