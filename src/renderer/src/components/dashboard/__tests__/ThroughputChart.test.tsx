import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThroughputChart } from '../ThroughputChart'
import type { CompletionBucket } from '../../../../../shared/ipc-channels'

function isoHour(base: Date, offsetHours: number): string {
  const d = new Date(base.getTime() + offsetHours * 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00`
}

describe('ThroughputChart', () => {
  const makeBucket = (hour: string, s: number, f: number): CompletionBucket => ({
    hour,
    successCount: s,
    failedCount: f
  })

  it('renders header numbers: last hour, avg/hr, peak', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [
      makeBucket(isoHour(now, -3), 2, 0),
      makeBucket(isoHour(now, -2), 5, 1),
      makeBucket(isoHour(now, -1), 3, 0),
      makeBucket(isoHour(now, 0), 4, 0)
    ]
    render(<ThroughputChart data={data} />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/avg/)).toBeInTheDocument()
    expect(screen.getByText(/peak/)).toBeInTheDocument()
  })

  it('shows empty state when all 24 hours are zero', () => {
    render(<ThroughputChart data={[]} />)
    expect(screen.getByText(/No completions in the last 24h/i)).toBeInTheDocument()
  })

  it('renders 24 hour slots when any data is present', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 3, 1)]
    const { container } = render(<ThroughputChart data={data} />)
    expect(container.querySelectorAll('[data-role="hour-slot"]')).toHaveLength(24)
  })

  it('renders stacked success + failed bars when data present', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 5, 2)]
    const { container } = render(<ThroughputChart data={data} />)
    expect(container.querySelector('[data-role="bar-success"]')).toBeTruthy()
    expect(container.querySelector('[data-role="bar-failed"]')).toBeTruthy()
  })

  it('Y-axis max rounds to next nice number above peak', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 7, 0)]
    const { container } = render(<ThroughputChart data={data} />)
    expect(container.querySelector('[data-testid="y-max"]')?.textContent).toBe('10')
  })

  it('Y-axis floor is 5', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 1, 0)]
    const { container } = render(<ThroughputChart data={data} />)
    expect(container.querySelector('[data-testid="y-max"]')?.textContent).toBe('5')
  })
})
