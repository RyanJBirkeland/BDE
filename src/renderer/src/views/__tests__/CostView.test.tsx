import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AgentRunCostRow, CostSummary } from '../../../../shared/types'

// Stable mock for fetchLocalAgents — must not be recreated each render
const mockFetchLocalAgents = vi.fn().mockResolvedValue(undefined)

// Mock costData store
vi.mock('../../stores/costData', () => ({
  useCostDataStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ fetchLocalAgents: mockFetchLocalAgents })
  ),
}))

// Mock useVisibilityAwareInterval — do nothing
vi.mock('../../hooks/useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn(),
}))

const mockSummary: CostSummary = {
  tasksToday: 3,
  tasksThisWeek: 12,
  tasksAllTime: 47,
  totalTokensThisWeek: 1_500_000,
  avgCostPerTask: 0.42,
  mostExpensiveTask: { task: 'Build feature X', costUsd: 1.25 },
}

const mockRun1: AgentRunCostRow = {
  id: 'run-aaa',
  task: 'Implement login flow',
  repo: 'BDE',
  status: 'completed',
  cost_usd: 0.38,
  tokens_in: 12000,
  tokens_out: 3000,
  cache_read: 8000,
  cache_create: 500,
  duration_ms: 120000,
  num_turns: 8,
  started_at: '2026-03-20T10:00:00.000Z',
  finished_at: '2026-03-20T10:02:00.000Z',
  pr_url: 'https://github.com/org/repo/pull/42',
}

const mockRun2: AgentRunCostRow = {
  id: 'run-bbb',
  task: 'Fix bug in auth',
  repo: 'BDE',
  status: 'completed',
  cost_usd: 0.12,
  tokens_in: 5000,
  tokens_out: 1000,
  cache_read: 0,
  cache_create: 0,
  duration_ms: 45000,
  num_turns: 3,
  started_at: '2026-03-21T14:30:00.000Z',
  finished_at: '2026-03-21T14:30:45.000Z',
  pr_url: null,
}

const mockCostApi = {
  summary: vi.fn(),
  agentRuns: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCostApi.summary.mockResolvedValue(mockSummary)
  mockCostApi.agentRuns.mockResolvedValue([mockRun1, mockRun2])

  Object.defineProperty(window, 'api', {
    value: {
      cost: mockCostApi,
      openExternal: vi.fn(),
    },
    writable: true,
    configurable: true,
  })
})

import CostView from '../CostView'

describe('CostView', () => {
  it('shows loading skeletons initially', () => {
    // Keep the promise pending so we stay in loading state
    mockCostApi.summary.mockReturnValue(new Promise(() => {}))
    mockCostApi.agentRuns.mockReturnValue(new Promise(() => {}))

    render(<CostView />)
    expect(screen.getByText('Cost Tracker')).toBeInTheDocument()
    // Skeletons are rendered as divs with bde-skeleton class
    const skeletons = document.querySelectorAll('.bde-skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders "Cost Tracker" title after data loads', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getAllByText('Cost Tracker').length).toBeGreaterThan(0)
    })
  })

  it('renders the Claude Code summary panel when data loads', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeInTheDocument()
    })
    expect(screen.getByText('Subscription')).toBeInTheDocument()
  })

  it('renders task counts from summary', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText(/3 today \/ 12 week \/ 47 all/)).toBeInTheDocument()
    })
  })

  it('renders total tokens from summary', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('1.5M')).toBeInTheDocument()
    })
  })

  it('renders most expensive task from summary', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('Build feature X')).toBeInTheDocument()
    })
  })

  it('renders agent run history table', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('Recent Agent Runs')).toBeInTheDocument()
    })
    expect(screen.getByText('Implement login flow')).toBeInTheDocument()
    expect(screen.getByText('Fix bug in auth')).toBeInTheDocument()
  })

  it('renders PR link for run with pr_url', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('Implement login flow')).toBeInTheDocument()
    })
    // The PR link renders an ExternalLink icon in an anchor
    const prLinks = document.querySelectorAll('.cost-table__pr-link')
    expect(prLinks.length).toBe(1)
  })

  it('renders -- for run without pr_url', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('Fix bug in auth')).toBeInTheDocument()
    })
    const noPr = document.querySelectorAll('.cost-table__no-pr')
    expect(noPr.length).toBe(1)
  })

  it('shows empty state when no runs', async () => {
    mockCostApi.agentRuns.mockResolvedValue([])
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('No completed agent runs')).toBeInTheDocument()
    })
    expect(screen.getByText('Complete a task to see cost breakdown')).toBeInTheDocument()
  })

  it('clicking sort header changes sort field', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('Est. Cost')).toBeInTheDocument()
    })
    // The sort indicator (▾) is a separate text node inside the <th>
    const costHeader = screen.getByText('Est. Cost').closest('th')!
    fireEvent.click(costHeader)
    // After clicking cost_usd is the sortField, so the indicator text node ' ▾' appears
    await waitFor(() => {
      expect(costHeader.textContent).toContain('▾')
    })
  })

  it('clicking Export CSV button copies data', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    })

    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText(/Export CSV/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/Export CSV/))
    expect(mockWriteText).toHaveBeenCalledTimes(1)
    const csvContent = mockWriteText.mock.calls[0][0] as string
    expect(csvContent).toContain('task,repo,cost_usd')
    expect(csvContent).toContain('Implement login flow')
  })

  it('clicking a row dispatches bde:navigate event', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByText('Implement login flow')).toBeInTheDocument()
    })

    const navigateEvents: CustomEvent[] = []
    window.addEventListener('bde:navigate', (e) => navigateEvents.push(e as CustomEvent))

    const row = screen.getByText('Implement login flow').closest('tr')!
    fireEvent.click(row)

    expect(navigateEvents).toHaveLength(1)
    expect(navigateEvents[0].detail).toMatchObject({ view: 'agents', sessionId: 'run-aaa' })
  })

  it('clicking PR link calls openExternal and does not propagate to row', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(document.querySelector('.cost-table__pr-link')).toBeInTheDocument()
    })

    const navigateEvents: CustomEvent[] = []
    window.addEventListener('bde:navigate', (e) => navigateEvents.push(e as CustomEvent))

    const prLink = document.querySelector('.cost-table__pr-link')!
    fireEvent.click(prLink)

    expect(window.api.openExternal).toHaveBeenCalledWith('https://github.com/org/repo/pull/42')
    // Row click should NOT have fired (stopPropagation in the anchor)
    expect(navigateEvents).toHaveLength(0)
  })

  it('handles API failure gracefully (no loading spinner stays forever)', async () => {
    mockCostApi.summary.mockRejectedValue(new Error('network error'))
    mockCostApi.agentRuns.mockRejectedValue(new Error('network error'))

    render(<CostView />)
    // After rejection, loading becomes false and we get the non-loading render
    await waitFor(() => {
      // Should show empty state for runs since data is empty
      expect(screen.getByText('No completed agent runs')).toBeInTheDocument()
    })
  })

  it('clicking Refresh button re-fetches data', async () => {
    render(<CostView />)
    await waitFor(() => {
      expect(screen.getByTitle('Refresh data')).toBeInTheDocument()
    })
    const callsBefore = mockCostApi.summary.mock.calls.length
    fireEvent.click(screen.getByTitle('Refresh data'))
    await waitFor(() => {
      expect(mockCostApi.summary.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})
