import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SuccessTrendChart } from '../SuccessTrendChart'

describe('SuccessTrendChart', () => {
  it('renders chart caption', () => {
    render(<SuccessTrendChart data={[]} />)
    expect(screen.getByText('success rate per day, last 14 days')).toBeInTheDocument()
  })

  it('renders with data', () => {
    const data = [
      { date: '2026-04-01', successRate: 80, doneCount: 8, failedCount: 2 },
      { date: '2026-04-02', successRate: 100, doneCount: 5, failedCount: 0 },
      { date: '2026-04-03', successRate: null, doneCount: 0, failedCount: 0 }
    ]
    const { container } = render(<SuccessTrendChart data={data} />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
