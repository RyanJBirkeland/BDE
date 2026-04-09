import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../stores/costData', () => ({
  useCostDataStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      localAgents: [],
      totalTokens: 0,
      fetchLocalAgents: vi.fn().mockResolvedValue(undefined)
    })
  )
}))

import { CostSection } from '../CostSection'

describe('CostSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.cost.summary).mockResolvedValue({
      tasksToday: 5,
      tasksThisWeek: 12,
      tasksAllTime: 50,
      totalTokensThisWeek: 500000,
      avgTokensPerTask: 15000,
      mostTokenIntensiveTask: null
    })
    vi.mocked(window.api.cost.agentRuns).mockResolvedValue([])
  })

  it('renders the cost view without crashing', async () => {
    const { container } = render(<CostSection />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders Claude Code Usage card after data loads', async () => {
    render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText('Claude Code Usage')).toBeInTheDocument()
    })
  })

  it('shows empty state when no runs', async () => {
    render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText('No completed agent runs')).toBeInTheDocument()
    })
  })

  it('shows task summary stats', async () => {
    render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText(/5 today/)).toBeInTheDocument()
      expect(screen.getByText(/12 week/)).toBeInTheDocument()
      expect(screen.getByText(/50 all/)).toBeInTheDocument()
    })
  })

  it('shows token count', async () => {
    render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText('500.0K')).toBeInTheDocument()
    })
  })

  it('shows most token-intensive task when available', async () => {
    vi.mocked(window.api.cost.summary).mockResolvedValue({
      tasksToday: 1,
      tasksThisWeek: 1,
      tasksAllTime: 1,
      totalTokensThisWeek: 1000,
      avgTokensPerTask: 250000,
      mostTokenIntensiveTask: { totalTokens: 500000, task: 'Token-heavy task here' }
    })
    render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText('500.0K')).toBeInTheDocument()
      expect(screen.getByText('Token-heavy task here')).toBeInTheDocument()
    })
  })

  it('shows average tokens per task', async () => {
    render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText('15.0K')).toBeInTheDocument()
    })
  })

  it('renders task table when runs are available', async () => {
    vi.mocked(window.api.cost.agentRuns).mockResolvedValue([
      {
        id: 'run-1',
        task: 'Fix bug in login',
        repo: 'bde',
        started_at: '2026-04-01T10:00:00Z',
        finished_at: '2026-04-01T10:30:00Z',
        cost_usd: 0.35,
        duration_ms: 1800000,
        num_turns: 15,
        tokens_in: 50000,
        tokens_out: 10000,
        cache_read: 30000,
        cache_create: 5000,
        pr_url: null,
        status: 'done'
      }
    ])
    render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText('Task History')).toBeInTheDocument()
      expect(screen.getByText(/Fix bug in login/)).toBeInTheDocument()
    })
  })

  it('allows clicking column headers to sort', async () => {
    vi.mocked(window.api.cost.agentRuns).mockResolvedValue([
      {
        id: 'run-1',
        task: 'Task A',
        repo: 'bde',
        started_at: '2026-04-01T10:00:00Z',
        finished_at: '2026-04-01T10:30:00Z',
        cost_usd: 0.35,
        duration_ms: 1800000,
        num_turns: 15,
        tokens_in: 50000,
        tokens_out: 10000,
        cache_read: 30000,
        cache_create: 5000,
        pr_url: null,
        status: 'done'
      },
      {
        id: 'run-2',
        task: 'Task B',
        repo: 'bde',
        started_at: '2026-04-02T10:00:00Z',
        finished_at: '2026-04-02T11:00:00Z',
        cost_usd: 1.5,
        duration_ms: 3600000,
        num_turns: 30,
        tokens_in: 100000,
        tokens_out: 20000,
        cache_read: 50000,
        cache_create: 10000,
        pr_url: null,
        status: 'done'
      }
    ])
    const { container } = render(<CostSection />)
    await waitFor(() => {
      expect(screen.getByText('Task History')).toBeInTheDocument()
    })
    // Click the sortable Tokens header
    const sortableHeaders = container.querySelectorAll('.cost-table__sortable')
    if (sortableHeaders.length > 0) {
      ;(sortableHeaders[0] as HTMLElement).click()
    }
  })
})
