import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CenterColumn } from '../CenterColumn'
import type { CompletionBucket } from '../../../../../shared/ipc-channels'

vi.mock('../../neon', () => ({
  NeonCard: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`neon-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <h3>{title}</h3>
      {children}
    </div>
  ),
  SankeyPipeline: ({
    stages,
    onStageClick
  }: {
    stages: Record<string, number>
    onStageClick: (filter: string) => void
  }) => (
    <div data-testid="sankey-pipeline" onClick={() => onStageClick('queued')}>
      Queued: {stages.queued}, Active: {stages.active}
    </div>
  ),
  MiniChart: () => <div data-testid="mini-chart">Chart</div>
}))

vi.mock('../ThroughputChart', () => ({
  ThroughputChart: () => <div data-testid="throughput-chart">ThroughputChart</div>
}))

vi.mock('../SuccessRateChart', () => ({
  SuccessRateChart: () => <div data-testid="success-rate-chart">SuccessRateChart</div>
}))

vi.mock('../LoadAverageChart', () => ({
  LoadAverageChart: () => <div data-testid="load-average-chart">LoadAverageChart</div>
}))

vi.mock('../../stores/dashboardData', () => ({
  useDashboardDataStore: {
    getState: () => ({
      fetchAll: vi.fn(),
      fetchLoad: vi.fn()
    })
  }
}))

describe('CenterColumn', () => {
  const mockThroughputData: CompletionBucket[] = []
  const defaultProps = {
    stats: {
      active: 0,
      queued: 0,
      blocked: 0,
      failed: 0,
      actualFailed: 0,
      review: 0,
      done: 0,
      doneToday: 0
    },
    partitions: {
      todo: [],
      inProgress: [],
      awaitingReview: [],
      done: [],
      blocked: [],
      failed: []
    },
    throughputData: mockThroughputData,
    successTrendData: [],
    loadData: null,
    tokenTrendData: [],
    tokenAvg: null,
    cardErrors: {},
    onFilterClick: vi.fn()
  }

  it('renders Pipeline card', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByTestId('sankey-pipeline')).toBeInTheDocument()
  })

  it('renders SankeyPipeline with correct stage counts', () => {
    const props = {
      ...defaultProps,
      partitions: {
        todo: [1, 2],
        inProgress: [1],
        awaitingReview: [1, 2, 3],
        done: [1, 2, 3, 4],
        blocked: [1],
        failed: [1, 2]
      }
    }
    render(<CenterColumn {...props} />)
    const sankey = screen.getByTestId('sankey-pipeline')
    expect(sankey).toHaveTextContent('Queued: 2, Active: 1')
  })

  it('renders ThroughputChart when no error', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByTestId('throughput-chart')).toBeInTheDocument()
  })

  it('renders throughput error card when cardErrors.throughput is set', () => {
    const props = { ...defaultProps, cardErrors: { throughput: 'Failed to load' } }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(screen.queryByTestId('throughput-chart')).not.toBeInTheDocument()
  })

  it('renders SuccessRateChart when no error', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByTestId('success-rate-chart')).toBeInTheDocument()
  })

  it('renders success trend error card when cardErrors.successTrend is set', () => {
    const props = { ...defaultProps, cardErrors: { successTrend: 'Trend error' } }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('Trend error')).toBeInTheDocument()
  })

  it('renders Loading... when loadData is null and no error', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders LoadAverageChart when loadData is provided', () => {
    const props = {
      ...defaultProps,
      loadData: { samples: [], cpuCount: 8 }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByTestId('load-average-chart')).toBeInTheDocument()
  })

  it('renders load error card when cardErrors.loadAverage is set', () => {
    const props = { ...defaultProps, cardErrors: { loadAverage: 'Load error' } }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('Load error')).toBeInTheDocument()
  })

  it('renders dash when tokenAvg is null', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders tokenAvg when provided', () => {
    const props = { ...defaultProps, tokenAvg: '42.5K' }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('42.5K')).toBeInTheDocument()
  })

  it('renders MiniChart for token trend', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByTestId('mini-chart')).toBeInTheDocument()
  })

  it('does not render Attention card (replaced by FiresStrip at DashboardView level)', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.queryByText('Attention')).not.toBeInTheDocument()
  })
})
