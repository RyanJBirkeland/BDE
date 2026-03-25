import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      tasks: [],
      loading: false,
      loadData: vi.fn().mockResolvedValue(undefined),
    })
  ),
}))

vi.mock('../../stores/costData', () => ({
  useCostDataStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      localAgents: [],
      totalCost: 0,
      fetchLocalAgents: vi.fn().mockResolvedValue(undefined),
    })
  ),
}))

vi.mock('../../components/neon', async () => {
  const actual = await vi.importActual<typeof import('../../components/neon')>(
    '../../components/neon',
  )
  return {
    ...actual,
    ScanlineOverlay: () => null,
    ParticleField: () => null,
  }
})

Object.defineProperty(window, 'api', {
  value: {
    getPrList: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn(),
    dashboard: {
      completionsPerHour: vi.fn().mockResolvedValue([]),
      recentEvents: vi.fn().mockResolvedValue([]),
    },
  },
  writable: true,
  configurable: true,
})

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import DashboardView from '../DashboardView'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Ops Deck command center', () => {
    render(<DashboardView />)
    expect(screen.getByText('BDE Command Center')).toBeInTheDocument()
  })

  it('renders stat counters for key metrics', () => {
    render(<DashboardView />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('PRs')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders pipeline and cost sections', () => {
    render(<DashboardView />)
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText(/Cost/)).toBeInTheDocument()
  })

  it('renders chart data from completionsPerHour', async () => {
    vi.mocked(window.api.dashboard.completionsPerHour).mockResolvedValue([
      { hour: '10:00', count: 5 },
      { hour: '11:00', count: 3 },
    ])
    render(<DashboardView />)
    await waitFor(() => {
      expect(screen.getByText('Completions / Hour')).toBeInTheDocument()
    })
  })

  it('renders feed events from recentEvents', async () => {
    vi.mocked(window.api.dashboard.recentEvents).mockResolvedValue([
      { id: 1, event_type: 'complete', agent_id: 'agent-1', payload: '', timestamp: Date.now() - 5000 },
      { id: 2, event_type: 'error', agent_id: 'agent-2', payload: '', timestamp: Date.now() - 10000 },
      { id: 3, event_type: 'spawn', agent_id: 'agent-3', payload: '', timestamp: Date.now() - 20000 },
    ])
    render(<DashboardView />)
    await waitFor(() => {
      expect(screen.getByText('complete: agent-1')).toBeInTheDocument()
      expect(screen.getByText('error: agent-2')).toBeInTheDocument()
      expect(screen.getByText('spawn: agent-3')).toBeInTheDocument()
    })
  })

  it('renders correct PR count from getPrList payload', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [
        { number: 1, title: 'PR1', html_url: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'a', sha: 'b' }, base: { ref: 'main' }, user: { login: 'u' }, merged: false, merged_at: null, repo: 'r' },
        { number: 2, title: 'PR2', html_url: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'c', sha: 'd' }, base: { ref: 'main' }, user: { login: 'u' }, merged: false, merged_at: null, repo: 'r' },
      ],
      checks: {},
    })
    render(<DashboardView />)
    // After the bugfix, PR count should be 2 (extracted from payload.prs.length)
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })
})
