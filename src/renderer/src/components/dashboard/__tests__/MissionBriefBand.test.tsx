import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MissionBriefBand } from '../MissionBriefBand'
import type { DashboardStats } from '../../../lib/dashboard-types'
import type { BriefHeadlinePart } from '../hooks/useDashboardData'

function makeStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    active: 0,
    queued: 0,
    blocked: 0,
    review: 0,
    done: 0,
    doneToday: 0,
    failed: 0,
    actualFailed: 0,
    ...overrides
  }
}

const headline: BriefHeadlinePart[] = [{ kind: 'text', text: 'All quiet.' }]

describe('MissionBriefBand', () => {
  it('renders 0% when no tasks exist', () => {
    render(
      <MissionBriefBand
        briefHeadlineParts={headline}
        stats={makeStats()}
        onOpenReview={vi.fn()}
        onOpenPlanner={vi.fn()}
        onNewTask={vi.fn()}
      />
    )
    expect(screen.getByText('0%')).toBeInTheDocument()
    // No NaN propagating through to the text content
    expect(screen.queryByText(/NaN/)).toBeNull()
  })

  it('renders 100% when every task is done', () => {
    render(
      <MissionBriefBand
        briefHeadlineParts={headline}
        stats={makeStats({ done: 5 })}
        onOpenReview={vi.fn()}
        onOpenPlanner={vi.fn()}
        onNewTask={vi.fn()}
      />
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('5 / 5 done')).toBeInTheDocument()
  })

  it('invokes onOpenReview when the Review queue button is clicked', () => {
    const onOpenReview = vi.fn()
    render(
      <MissionBriefBand
        briefHeadlineParts={headline}
        stats={makeStats({ review: 2 })}
        onOpenReview={onOpenReview}
        onOpenPlanner={vi.fn()}
        onNewTask={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText(/Review queue · 2/))
    expect(onOpenReview).toHaveBeenCalledTimes(1)
  })

  it('invokes onNewTask when the + Task button is clicked', () => {
    const onNewTask = vi.fn()
    render(
      <MissionBriefBand
        briefHeadlineParts={headline}
        stats={makeStats()}
        onOpenReview={vi.fn()}
        onOpenPlanner={vi.fn()}
        onNewTask={onNewTask}
      />
    )
    fireEvent.click(screen.getByText('+ Task'))
    expect(onNewTask).toHaveBeenCalledTimes(1)
  })

  it('invokes onOpenPlanner when the Plan button is clicked', () => {
    const onOpenPlanner = vi.fn()
    render(
      <MissionBriefBand
        briefHeadlineParts={headline}
        stats={makeStats()}
        onOpenReview={vi.fn()}
        onOpenPlanner={onOpenPlanner}
        onNewTask={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Plan'))
    expect(onOpenPlanner).toHaveBeenCalledTimes(1)
  })
})
