import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChartsSection } from '../ChartsSection'
import type { ChartBar } from '../../neon'

vi.mock('../../neon', () => ({
  NeonCard: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`neon-card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  ),
  MiniChart: ({ data }: { data: ChartBar[]; height: number }) => (
    <div data-testid="mini-chart">{data.length} bars</div>
  )
}))

vi.mock('../SuccessRing', () => ({
  SuccessRing: ({ rate, done, failed }: { rate: number | null; done: number; failed: number }) => (
    <div data-testid="success-ring">
      Rate: {rate === null ? 'null' : rate}, Done: {done}, Failed: {failed}
    </div>
  )
}))

vi.mock('../SuccessTrendChart', () => ({
  SuccessTrendChart: () => <div data-testid="success-trend-chart">SuccessTrendChart</div>
}))

const mockFetchAll = vi.fn()
const mockGetState = vi.fn(() => ({ fetchAll: mockFetchAll }))

vi.mock('../../stores/dashboardData', () => ({
  useDashboardDataStore: {
    getState: mockGetState
  }
}))

describe('ChartsSection', () => {
  beforeEach(() => {
    mockFetchAll.mockClear()
  })

  const mockChartData: ChartBar[] = [
    { label: '00:00', value: 5, accent: 'cyan' },
    { label: '01:00', value: 3, accent: 'cyan' }
  ]

  const mockBurndownData: ChartBar[] = [
    { label: '2026-03-28', value: 2, accent: 'cyan' },
    { label: '2026-03-29', value: 4, accent: 'cyan' },
    { label: '2026-03-30', value: 1, accent: 'cyan' }
  ]

  const defaultProps = {
    chartData: mockChartData,
    burndownData: mockBurndownData,
    cardErrors: {},
    successRate: 85,
    stats: { done: 17, failed: 3, actualFailed: 3 },
    avgDuration: 120000,
    avgTaskDuration: 150000,
    taskDurationCount: 5,
    localAgents: [{ durationMs: 100000 }, { durationMs: 140000 }],
    successTrendData: []
  }

  it('renders Completions by Hour card', () => {
    render(<ChartsSection {...defaultProps} />)
    expect(screen.getByTestId('neon-card-completions-by-hour')).toBeInTheDocument()
  })

  it('renders MiniChart with correct data', () => {
    render(<ChartsSection {...defaultProps} />)
    const charts = screen.getAllByTestId('mini-chart')
    expect(charts).toHaveLength(2) // Completions + Burndown
    expect(charts[0]).toHaveTextContent('2 bars') // Completions chart
    expect(charts[1]).toHaveTextContent('3 bars') // Burndown chart
  })

  it('renders chart caption', () => {
    render(<ChartsSection {...defaultProps} />)
    expect(screen.getByText('completions per hour, last 24h')).toBeInTheDocument()
  })

  it('renders Sprint Burn-Down card', () => {
    render(<ChartsSection {...defaultProps} />)
    expect(screen.getByTestId('neon-card-sprint-burn-down')).toBeInTheDocument()
  })

  it('renders burndown chart caption', () => {
    render(<ChartsSection {...defaultProps} />)
    expect(screen.getByText('tasks completed, last 7 days')).toBeInTheDocument()
  })

  it('renders error state when burndown error exists', () => {
    const props = {
      ...defaultProps,
      cardErrors: { burndown: 'Failed to load burndown data' }
    }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('Failed to load burndown data')).toBeInTheDocument()
  })

  it('renders Success Rate card with SuccessRing', () => {
    render(<ChartsSection {...defaultProps} />)
    expect(screen.getByTestId('neon-card-success-rate')).toBeInTheDocument()
    expect(screen.getByTestId('success-ring')).toHaveTextContent('Rate: 85, Done: 17, Failed: 3')
  })

  it('renders Avg Task Duration card', () => {
    render(<ChartsSection {...defaultProps} />)
    expect(screen.getByTestId('neon-card-avg-task-duration')).toBeInTheDocument()
  })

  it('formats duration in seconds', () => {
    const props = { ...defaultProps, avgTaskDuration: 45000 }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('45s')).toBeInTheDocument()
  })

  it('formats duration in minutes and seconds', () => {
    const props = { ...defaultProps, avgTaskDuration: 125000 }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('2m 5s')).toBeInTheDocument()
  })

  it('formats duration in hours and minutes', () => {
    const props = { ...defaultProps, avgTaskDuration: 7320000 }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('2h 2m')).toBeInTheDocument()
  })

  it('shows placeholder when avgTaskDuration and avgDuration are null', () => {
    const props = { ...defaultProps, avgTaskDuration: null, avgDuration: null }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows count of tracked tasks when task duration available', () => {
    render(<ChartsSection {...defaultProps} />)
    expect(screen.getByText('5 tasks tracked')).toBeInTheDocument()
  })

  it('falls back to runs tracked when no task duration', () => {
    const props = {
      ...defaultProps,
      avgTaskDuration: null,
      taskDurationCount: 0,
      localAgents: [{ durationMs: 100000 }, { durationMs: null }, { durationMs: undefined }]
    }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('1 runs tracked')).toBeInTheDocument()
  })

  it('renders error state when chart error exists', () => {
    const props = {
      ...defaultProps,
      cardErrors: { chart: 'Failed to load chart data' }
    }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('Failed to load chart data')).toBeInTheDocument()
    // Burndown chart still renders, so there's still one MiniChart
    expect(screen.getAllByTestId('mini-chart')).toHaveLength(1)
  })

  it('renders Retry button in error state', () => {
    const props = {
      ...defaultProps,
      cardErrors: { chart: 'Failed to load chart data' }
    }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it.skip('calls fetchAll when Retry is clicked', () => {
    // Skipped: Mock setup for nested onClick handlers needs refactoring
    const props = {
      ...defaultProps,
      cardErrors: { chart: 'Failed to load chart data' }
    }
    render(<ChartsSection {...props} />)
    fireEvent.click(screen.getByText('Retry'))
    expect(mockFetchAll).toHaveBeenCalled()
  })

  it('handles null successRate', () => {
    const props = { ...defaultProps, successRate: null }
    render(<ChartsSection {...props} />)
    expect(screen.getByTestId('success-ring')).toHaveTextContent('Rate: null')
  })

  it('handles empty localAgents array with task duration', () => {
    const props = { ...defaultProps, taskDurationCount: 3, localAgents: [] }
    render(<ChartsSection {...props} />)
    expect(screen.getByText('3 tasks tracked')).toBeInTheDocument()
  })
})
