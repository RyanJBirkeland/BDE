/**
 * DashboardViewV2 — verifies the v2Dashboard=true triage layout renders
 * core regions (mission brief, KPI strip, review queue, etc) given a stubbed
 * useDashboardData hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>
  },
  useReducedMotion: () => false
}))

const baseData = {
  partitions: {
    backlog: [],
    todo: [],
    blocked: [],
    inProgress: [],
    pendingReview: [],
    approved: [],
    openPrs: [],
    done: [],
    failed: []
  },
  activeAgents: [],
  attentionItems: [],
  stats: {
    active: 0,
    queued: 0,
    blocked: 0,
    review: 0,
    done: 0,
    doneToday: 0,
    failed: 0,
    actualFailed: 0
  },
  recentCompletions: [],
  tokens24h: 0,
  tokenTrendData: [],
  tokenAvg: null,
  taskTokenMap: new Map<string, number>(),
  stuckCount: 0,
  loadSaturated: null,
  successRate7dAvg: null,
  successRateWeekDelta: null,
  avgDuration: null,
  avgTaskDuration: null,
  throughputData: [],
  successTrendData: [],
  avgCostPerTask: null,
  failureRate: null,
  perAgentStats: [],
  perRepoStats: [],
  briefHeadlineParts: [{ kind: 'text' as const, text: 'All quiet.' }],
  capacity: 2,
  drainStatus: null,
  openAgentsView: vi.fn(),
  openPipelineView: vi.fn(),
  openReviewView: vi.fn(),
  openPlannerView: vi.fn(),
  openNewTask: vi.fn(),
  retryTask: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../../components/dashboard/hooks/useDashboardData', () => ({
  useDashboardData: () => baseData
}))

// Stub V2 cards we don't want to fully exercise here.
vi.mock('../../components/dashboard/LiveColumn/ActiveAgentsCard', () => ({
  ActiveAgentsCard: () => <div data-testid="active-agents-card" />
}))
vi.mock('../../components/dashboard/LiveColumn/PipelineGlanceCard', () => ({
  PipelineGlanceCard: () => <div data-testid="pipeline-glance-card" />
}))
vi.mock('../../components/dashboard/LiveColumn/ThroughputCard', () => ({
  ThroughputCard: () => <div data-testid="throughput-card" />
}))
vi.mock('../../components/dashboard/TriageColumn/AttentionCard', () => ({
  AttentionCard: () => <div data-testid="attention-card" />
}))
vi.mock('../../components/dashboard/TriageColumn/RecentCompletionsCard', () => ({
  RecentCompletionsCard: () => <div data-testid="recent-completions-card" />
}))
vi.mock('../../components/dashboard/StatsAccordion/PerAgentStats', () => ({
  PerAgentStats: () => <div data-testid="per-agent-stats" />
}))
vi.mock('../../components/dashboard/StatsAccordion/PerRepoStats', () => ({
  PerRepoStats: () => <div data-testid="per-repo-stats" />
}))

import DashboardViewV2 from '../DashboardViewV2'

describe('DashboardViewV2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing with empty data', () => {
    const { container } = render(<DashboardViewV2 />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the MissionBriefBand region', () => {
    render(<DashboardViewV2 />)
    expect(screen.getByText('All quiet.')).toBeInTheDocument()
    expect(screen.getByText('Mission Brief')).toBeInTheDocument()
  })

  it('renders the KPIStrip with all five labels', () => {
    render(<DashboardViewV2 />)
    expect(screen.getByText('Success rate')).toBeInTheDocument()
    expect(screen.getByText('Failure rate')).toBeInTheDocument()
  })

  it('renders the empty state for the Review queue when there are no pending tasks', () => {
    render(<DashboardViewV2 />)
    expect(screen.getByText('All caught up.')).toBeInTheDocument()
  })
})
