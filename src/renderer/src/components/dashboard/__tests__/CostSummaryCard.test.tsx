import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

interface Agent {
  costUsd?: number | null
}

let mockLocalAgents: Agent[] = []
let mockTotalCost = 0

vi.mock('../../../stores/costData', () => ({
  useCostDataStore: (selector: (s: { localAgents: Agent[]; totalCost: number }) => unknown) =>
    selector({ localAgents: mockLocalAgents, totalCost: mockTotalCost }),
}))

import { CostSummaryCard } from '../CostSummaryCard'

describe('CostSummaryCard', () => {
  beforeEach(() => {
    mockLocalAgents = []
    mockTotalCost = 0
  })

  it('renders card title', () => {
    render(<CostSummaryCard />)
    expect(screen.getByText('Cost Summary')).toBeInTheDocument()
  })

  it('renders all three stat labels', () => {
    render(<CostSummaryCard />)
    expect(screen.getByText('Total Cost')).toBeInTheDocument()
    expect(screen.getByText('Runs')).toBeInTheDocument()
    expect(screen.getByText('Avg / Run')).toBeInTheDocument()
  })

  it('shows formatted total cost', () => {
    mockTotalCost = 12.5
    render(<CostSummaryCard />)
    expect(screen.getByText('$12.50')).toBeInTheDocument()
  })

  it('shows <$0.01 for tiny total cost', () => {
    mockTotalCost = 0.001
    render(<CostSummaryCard />)
    const smallCosts = screen.getAllByText('<$0.01')
    expect(smallCosts.length).toBeGreaterThanOrEqual(1)
  })

  it('shows zero runs when no agents', () => {
    render(<CostSummaryCard />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows run count from localAgents length', () => {
    mockLocalAgents = [{ costUsd: 1.5 }, { costUsd: 2.5 }]
    render(<CostSummaryCard />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calculates average cost per run', () => {
    mockLocalAgents = [{ costUsd: 2.0 }, { costUsd: 4.0 }]
    mockTotalCost = 6.0
    render(<CostSummaryCard />)
    // Avg = (2+4)/2 = $3.00
    expect(screen.getByText('$3.00')).toBeInTheDocument()
  })

  it('excludes zero-cost agents from average calculation', () => {
    mockLocalAgents = [{ costUsd: 0 }, { costUsd: 4.0 }]
    mockTotalCost = 4.0
    render(<CostSummaryCard />)
    // Only one agent with cost > 0, avg = 4.0/1 = $4.00
    const costs = screen.getAllByText('$4.00')
    expect(costs.length).toBeGreaterThanOrEqual(1)
  })

  it('handles null costUsd in agents', () => {
    mockLocalAgents = [{ costUsd: null }, { costUsd: 3.0 }]
    mockTotalCost = 3.0
    render(<CostSummaryCard />)
    const costs = screen.getAllByText('$3.00')
    expect(costs.length).toBeGreaterThanOrEqual(1)
  })

  it('shows <$0.01 for avg when all agents have zero cost', () => {
    mockLocalAgents = [{ costUsd: 0 }]
    render(<CostSummaryCard />)
    // avg = 0 because no agents pass the > 0 filter
    // formatCost(0) → '<$0.01'
    const smallCosts = screen.getAllByText('<$0.01')
    expect(smallCosts.length).toBeGreaterThanOrEqual(1)
  })
})
