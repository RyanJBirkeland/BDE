import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatusCounters } from '../StatusCounters'

vi.mock('../../neon', () => ({
  StatCounter: ({
    label,
    value,
    onClick
  }: {
    label: string
    value: number
    accent: string
    onClick: () => void
  }) => (
    <button
      data-testid={`stat-counter-${label.toLowerCase()}`}
      onClick={onClick}
      type="button"
    >
      {label}: {value}
    </button>
  )
}))

describe('StatusCounters', () => {
  const defaultStats = {
    active: 2,
    queued: 3,
    blocked: 1,
    failed: 0,
    review: 1,
    done: 10
  }

  it('renders all stat counters with correct values', () => {
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={vi.fn()}
        onNewTaskClick={vi.fn()}
      />
    )
    expect(screen.getByTestId('stat-counter-active')).toHaveTextContent('Active: 2')
    expect(screen.getByTestId('stat-counter-queued')).toHaveTextContent('Queued: 3')
    expect(screen.getByTestId('stat-counter-blocked')).toHaveTextContent('Blocked: 1')
    expect(screen.getByTestId('stat-counter-failed')).toHaveTextContent('Failed: 0')
    expect(screen.getByTestId('stat-counter-review')).toHaveTextContent('Review: 1')
    expect(screen.getByTestId('stat-counter-prs')).toHaveTextContent('PRs: 5')
    expect(screen.getByTestId('stat-counter-done')).toHaveTextContent('Done: 10')
  })

  it('calls onFilterClick with correct filter when Active is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={mockFilterClick}
        onNewTaskClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('stat-counter-active'))
    expect(mockFilterClick).toHaveBeenCalledWith('in-progress')
  })

  it('calls onFilterClick with correct filter when Queued is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={mockFilterClick}
        onNewTaskClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('stat-counter-queued'))
    expect(mockFilterClick).toHaveBeenCalledWith('todo')
  })

  it('calls onFilterClick with correct filter when Blocked is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={mockFilterClick}
        onNewTaskClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('stat-counter-blocked'))
    expect(mockFilterClick).toHaveBeenCalledWith('blocked')
  })

  it('calls onFilterClick with correct filter when Failed is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={mockFilterClick}
        onNewTaskClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('stat-counter-failed'))
    expect(mockFilterClick).toHaveBeenCalledWith('failed')
  })

  it('calls onFilterClick with correct filter when Review is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={mockFilterClick}
        onNewTaskClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('stat-counter-review'))
    expect(mockFilterClick).toHaveBeenCalledWith('awaiting-review')
  })

  it('calls onFilterClick with correct filter when PRs is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={mockFilterClick}
        onNewTaskClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('stat-counter-prs'))
    expect(mockFilterClick).toHaveBeenCalledWith('awaiting-review')
  })

  it('calls onFilterClick with correct filter when Done is clicked', () => {
    const mockFilterClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={mockFilterClick}
        onNewTaskClick={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('stat-counter-done'))
    expect(mockFilterClick).toHaveBeenCalledWith('done')
  })

  it('renders New Task button', () => {
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={vi.fn()}
        onNewTaskClick={vi.fn()}
      />
    )
    expect(screen.getByText('New Task')).toBeInTheDocument()
  })

  it('calls onNewTaskClick when New Task button is clicked', () => {
    const mockNewTaskClick = vi.fn()
    render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={vi.fn()}
        onNewTaskClick={mockNewTaskClick}
      />
    )
    fireEvent.click(screen.getByText('New Task'))
    expect(mockNewTaskClick).toHaveBeenCalledOnce()
  })

  it('renders with zero values', () => {
    const zeroStats = {
      active: 0,
      queued: 0,
      blocked: 0,
      failed: 0,
      review: 0,
      done: 0
    }
    render(
      <StatusCounters
        stats={zeroStats}
        awaitingReviewCount={0}
        onFilterClick={vi.fn()}
        onNewTaskClick={vi.fn()}
      />
    )
    expect(screen.getByTestId('stat-counter-active')).toHaveTextContent('Active: 0')
    expect(screen.getByTestId('stat-counter-done')).toHaveTextContent('Done: 0')
  })

  it('has correct accessibility attributes', () => {
    const { container } = render(
      <StatusCounters
        stats={defaultStats}
        awaitingReviewCount={5}
        onFilterClick={vi.fn()}
        onNewTaskClick={vi.fn()}
      />
    )
    const region = container.querySelector('[role="region"]')
    expect(region).toHaveAttribute('aria-label', 'Task statistics')
  })
})
