import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false
}))

import { KPIStrip } from '../KPIStrip'

const baseProps = {
  successRate7dAvg: null,
  successRateWeekDelta: null,
  avgDuration: null,
  tokenAvg: null,
  tokenTrendData: [],
  avgCostPerTask: null,
  failureRate: null,
  successTrendData: []
}

describe('KPIStrip', () => {
  it('renders -- in every cell when all metric props are null', () => {
    render(<KPIStrip {...baseProps} />)
    const dashes = screen.getAllByText('--')
    // Five cells, each with a value of "--"
    expect(dashes.length).toBeGreaterThanOrEqual(5)
  })

  it('shows a positive delta indicator when successRateWeekDelta > 0', () => {
    render(<KPIStrip {...baseProps} successRateWeekDelta={3.4} />)
    expect(screen.getByText('+3.4%')).toBeInTheDocument()
  })

  it('shows a negative delta indicator when successRateWeekDelta < 0', () => {
    render(<KPIStrip {...baseProps} successRateWeekDelta={-2.1} />)
    expect(screen.getByText('-2.1%')).toBeInTheDocument()
  })

  it('renders all five metric labels', () => {
    render(<KPIStrip {...baseProps} />)
    expect(screen.getByText('Success rate')).toBeInTheDocument()
    expect(screen.getByText('Avg duration')).toBeInTheDocument()
    expect(screen.getByText('Tokens / run')).toBeInTheDocument()
    expect(screen.getByText('Cost / task')).toBeInTheDocument()
    expect(screen.getByText('Failure rate')).toBeInTheDocument()
  })
})
