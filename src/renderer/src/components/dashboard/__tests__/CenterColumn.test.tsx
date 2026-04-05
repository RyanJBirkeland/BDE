import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CenterColumn } from '../CenterColumn'
import type { ChartBar } from '../../neon'

vi.mock('../../neon', () => ({
  NeonCard: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`neon-card-${title.toLowerCase()}`}>
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

vi.mock('../ChartsSection', () => ({
  ChartsSection: () => <div data-testid="charts-section">ChartsSection</div>
}))

vi.mock('../SuccessRing', () => ({
  SuccessRing: () => <div data-testid="success-ring">SuccessRing</div>
}))

vi.mock('../../stores/dashboardData', () => ({
  useDashboardDataStore: {
    getState: () => ({
      fetchAll: vi.fn()
    })
  }
}))

describe('CenterColumn', () => {
  const mockChartData: ChartBar[] = []
  const defaultProps = {
    stats: {
      active: 0,
      queued: 0,
      blocked: 0,
      failed: 0,
      actualFailed: 0,
      review: 0,
      done: 0
    },
    partitions: {
      todo: [],
      inProgress: [],
      awaitingReview: [],
      done: [],
      blocked: [],
      failed: []
    },
    chartData: mockChartData,
    cardErrors: {},
    successRate: 85,
    avgDuration: 120000,
    localAgents: [],
    onFilterClick: vi.fn(),
    onKeyDownFor: vi.fn(() => vi.fn())
  }

  it('renders Pipeline card', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByTestId('neon-card-pipeline')).toBeInTheDocument()
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

  it('renders ChartsSection', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.getByTestId('charts-section')).toBeInTheDocument()
  })

  it('does not render Attention card when no issues', () => {
    render(<CenterColumn {...defaultProps} />)
    expect(screen.queryByTestId('neon-card-attention')).not.toBeInTheDocument()
  })

  it('renders Attention card when failed tasks exist', () => {
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, failed: 2 }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByTestId('neon-card-attention')).toBeInTheDocument()
    expect(screen.getByText('2 failed tasks')).toBeInTheDocument()
  })

  it('renders singular text for 1 failed task', () => {
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, failed: 1 }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('1 failed task')).toBeInTheDocument()
  })

  it('renders Attention card when PRs awaiting review exist', () => {
    const props = {
      ...defaultProps,
      partitions: {
        ...defaultProps.partitions,
        awaitingReview: [1, 2, 3]
      }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByTestId('neon-card-attention')).toBeInTheDocument()
    expect(screen.getByText('3 PRs awaiting review')).toBeInTheDocument()
  })

  it('renders singular text for 1 PR awaiting review', () => {
    const props = {
      ...defaultProps,
      partitions: {
        ...defaultProps.partitions,
        awaitingReview: [1]
      }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('1 PR awaiting review')).toBeInTheDocument()
  })

  it('renders Attention card when blocked tasks exist', () => {
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, blocked: 4 }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByTestId('neon-card-attention')).toBeInTheDocument()
    expect(screen.getByText('4 blocked tasks')).toBeInTheDocument()
  })

  it('renders singular text for 1 blocked task', () => {
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, blocked: 1 }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('1 blocked task')).toBeInTheDocument()
  })

  it('renders all attention items when all issues exist', () => {
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, failed: 2, blocked: 1 },
      partitions: {
        ...defaultProps.partitions,
        awaitingReview: [1, 2]
      }
    }
    render(<CenterColumn {...props} />)
    expect(screen.getByText('2 failed tasks')).toBeInTheDocument()
    expect(screen.getByText('2 PRs awaiting review')).toBeInTheDocument()
    expect(screen.getByText('1 blocked task')).toBeInTheDocument()
  })

  it('calls onFilterClick with failed when failed item is clicked', () => {
    const mockFilterClick = vi.fn()
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, failed: 1 },
      onFilterClick: mockFilterClick
    }
    render(<CenterColumn {...props} />)
    fireEvent.click(screen.getByText('1 failed task'))
    expect(mockFilterClick).toHaveBeenCalledWith('failed')
  })

  it('calls onFilterClick with awaiting-review when PR item is clicked', () => {
    const mockFilterClick = vi.fn()
    const props = {
      ...defaultProps,
      partitions: {
        ...defaultProps.partitions,
        awaitingReview: [1]
      },
      onFilterClick: mockFilterClick
    }
    render(<CenterColumn {...props} />)
    fireEvent.click(screen.getByText('1 PR awaiting review'))
    expect(mockFilterClick).toHaveBeenCalledWith('awaiting-review')
  })

  it('calls onFilterClick with blocked when blocked item is clicked', () => {
    const mockFilterClick = vi.fn()
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, blocked: 1 },
      onFilterClick: mockFilterClick
    }
    render(<CenterColumn {...props} />)
    fireEvent.click(screen.getByText('1 blocked task'))
    expect(mockFilterClick).toHaveBeenCalledWith('blocked')
  })

  it('calls onKeyDownFor for failed item keyboard interaction', () => {
    const mockKeyDown = vi.fn()
    const mockOnKeyDownFor = vi.fn(() => mockKeyDown)
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, failed: 1 },
      onKeyDownFor: mockOnKeyDownFor
    }
    render(<CenterColumn {...props} />)
    const failedItem = screen.getByText('1 failed task')
    fireEvent.keyDown(failedItem, { key: 'Enter' })
    expect(mockOnKeyDownFor).toHaveBeenCalledWith('failed')
    expect(mockKeyDown).toHaveBeenCalled()
  })

  it('calls onKeyDownFor for PR item keyboard interaction', () => {
    const mockKeyDown = vi.fn()
    const mockOnKeyDownFor = vi.fn(() => mockKeyDown)
    const props = {
      ...defaultProps,
      partitions: {
        ...defaultProps.partitions,
        awaitingReview: [1]
      },
      onKeyDownFor: mockOnKeyDownFor
    }
    render(<CenterColumn {...props} />)
    const prItem = screen.getByText('1 PR awaiting review')
    fireEvent.keyDown(prItem, { key: 'Enter' })
    expect(mockOnKeyDownFor).toHaveBeenCalledWith('awaiting-review')
    expect(mockKeyDown).toHaveBeenCalled()
  })

  it('calls onKeyDownFor for blocked item keyboard interaction', () => {
    const mockKeyDown = vi.fn()
    const mockOnKeyDownFor = vi.fn(() => mockKeyDown)
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, blocked: 1 },
      onKeyDownFor: mockOnKeyDownFor
    }
    render(<CenterColumn {...props} />)
    const blockedItem = screen.getByText('1 blocked task')
    fireEvent.keyDown(blockedItem, { key: 'Enter' })
    expect(mockOnKeyDownFor).toHaveBeenCalledWith('blocked')
    expect(mockKeyDown).toHaveBeenCalled()
  })

  it('has correct accessibility attributes for attention items', () => {
    const props = {
      ...defaultProps,
      stats: { ...defaultProps.stats, failed: 1 }
    }
    render(<CenterColumn {...props} />)
    const failedItem = screen.getByText('1 failed task')
    expect(failedItem.closest('[role="button"]')).toBeInTheDocument()
    expect(failedItem.closest('[tabIndex="0"]')).toBeInTheDocument()
  })
})
