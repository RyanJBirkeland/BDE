import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SuccessRateChart } from '../SuccessRateChart'

interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

describe('SuccessRateChart', () => {
  it('100% maps to a fixed Y pixel regardless of dataset max', () => {
    const dataA: DailySuccessRate[] = [
      { date: '2026-04-01', successRate: 100, doneCount: 10, failedCount: 0 },
      { date: '2026-04-02', successRate: 100, doneCount: 10, failedCount: 0 }
    ]
    const dataB: DailySuccessRate[] = [
      { date: '2026-04-01', successRate: 100, doneCount: 10, failedCount: 0 },
      { date: '2026-04-02', successRate: 50, doneCount: 5, failedCount: 5 }
    ]
    const { container: a } = render(<SuccessRateChart data={dataA} />)
    const { container: b } = render(<SuccessRateChart data={dataB} />)
    const yA = a.querySelector('[data-testid="point-0"]')?.getAttribute('cy')
    const yB = b.querySelector('[data-testid="point-0"]')?.getAttribute('cy')
    expect(yA).toBe(yB)
  })

  it('renders a gap for null days — not a phantom zero', () => {
    const data: DailySuccessRate[] = [
      { date: '2026-04-01', successRate: 100, doneCount: 1, failedCount: 0 },
      { date: '2026-04-02', successRate: null, doneCount: 0, failedCount: 0 },
      { date: '2026-04-03', successRate: 100, doneCount: 1, failedCount: 0 }
    ]
    const { container } = render(<SuccessRateChart data={data} />)
    const path = container.querySelector('path[data-role="trend-line"]')?.getAttribute('d')
    // Two segments — two separate M commands
    expect(path?.match(/M /g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('shows 7-day average and week-over-week delta in header', () => {
    // 14 days total; last 7 avg = 98.0, prior 7 avg = 94.0, delta = +4.0
    const data: DailySuccessRate[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-03-${String(25 + i).padStart(2, '0')}`,
        successRate: 94,
        doneCount: 10,
        failedCount: 1
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-04-${String(1 + i).padStart(2, '0')}`,
        successRate: 98,
        doneCount: 10,
        failedCount: 1
      }))
    ]
    render(<SuccessRateChart data={data} />)
    expect(screen.getByText(/98\.0%/)).toBeInTheDocument()
    expect(screen.getByText(/\+4\.0%/)).toBeInTheDocument()
  })

  it('empty state when all days null', () => {
    const data: DailySuccessRate[] = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      successRate: null,
      doneCount: 0,
      failedCount: 0
    }))
    render(<SuccessRateChart data={data} />)
    expect(screen.getByText(/No completed tasks in the last 14 days/i)).toBeInTheDocument()
  })
})
