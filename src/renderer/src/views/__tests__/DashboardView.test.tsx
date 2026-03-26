import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      tasks: [],
      loading: false,
      loadData: vi.fn().mockResolvedValue(undefined)
    })
  )
}))

vi.mock('../../stores/costData', () => ({
  useCostDataStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      localAgents: [],
      totalCost: 0,
      fetchLocalAgents: vi.fn().mockResolvedValue(undefined)
    })
  )
}))

vi.mock('../../components/neon', async () => {
  const actual =
    await vi.importActual<typeof import('../../components/neon')>('../../components/neon')
  return {
    ...actual,
    ScanlineOverlay: () => null,
    ParticleField: () => null
  }
})

Object.defineProperty(window, 'api', {
  value: {
    getPrList: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn(),
    dashboard: {
      completionsPerHour: vi.fn().mockResolvedValue([]),
      recentEvents: vi.fn().mockResolvedValue([])
    }
  },
  writable: true,
  configurable: true
})

// ---------------------------------------------------------------------------
// Subject + stores
// ---------------------------------------------------------------------------

import DashboardView from '../DashboardView'
import { useSprintUI } from '../../stores/sprintUI'
import { useUIStore } from '../../stores/ui'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    useSprintUI.setState({ searchQuery: '', statusFilter: 'all' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the Ops Deck command center', () => {
    render(<DashboardView />)
    expect(screen.getByText('BDE Command Center')).toBeInTheDocument()
  })

  it('renders stat counters for key metrics', () => {
    render(<DashboardView />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('PRs')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders pipeline and cost sections', () => {
    render(<DashboardView />)
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText(/Cost/)).toBeInTheDocument()
  })

  it('clicking Active stat navigates to Sprint with in-progress filter', () => {
    render(<DashboardView />)
    const activeStat = screen.getByText('Active').closest('[role="button"]')!
    fireEvent.click(activeStat)

    expect(useSprintUI.getState().statusFilter).toBe('in-progress')
    expect(useUIStore.getState().activeView).toBe('sprint')
  })

  it('clicking Done stat navigates to Sprint with done filter', () => {
    render(<DashboardView />)
    // "Done" may appear in both stats and pipeline — find the one with role=button
    const doneStats = screen.getAllByText('Done')
    const doneStat = doneStats
      .find((el) => el.closest('[role="button"]'))!
      .closest('[role="button"]')!
    fireEvent.click(doneStat)

    expect(useSprintUI.getState().statusFilter).toBe('done')
    expect(useUIStore.getState().activeView).toBe('sprint')
  })

  it('clicking Blocked stat navigates to Sprint with blocked filter', () => {
    render(<DashboardView />)
    const blockedElements = screen.getAllByText('Blocked')
    const blockedStat = blockedElements
      .find((el) => el.closest('[role="button"]'))!
      .closest('[role="button"]')!
    fireEvent.click(blockedStat)

    expect(useSprintUI.getState().statusFilter).toBe('blocked')
    expect(useUIStore.getState().activeView).toBe('sprint')
  })

  it('renders chart data from completionsPerHour', async () => {
    vi.mocked(window.api.dashboard.completionsPerHour).mockResolvedValue([
      { hour: '10:00', count: 5 },
      { hour: '11:00', count: 3 }
    ])
    render(<DashboardView />)
    // Flush initial useBackoffInterval tick (setTimeout 0ms with jitter=0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('Completions / Hour')).toBeInTheDocument()
  })

  it('renders feed events from recentEvents', async () => {
    vi.mocked(window.api.dashboard.recentEvents).mockResolvedValue([
      {
        id: 1,
        event_type: 'complete',
        agent_id: 'agent-1',
        payload: '',
        timestamp: Date.now() - 5000
      },
      {
        id: 2,
        event_type: 'error',
        agent_id: 'agent-2',
        payload: '',
        timestamp: Date.now() - 10000
      },
      {
        id: 3,
        event_type: 'spawn',
        agent_id: 'agent-3',
        payload: '',
        timestamp: Date.now() - 20000
      }
    ])
    render(<DashboardView />)
    // Flush initial useBackoffInterval tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('complete: agent-1')).toBeInTheDocument()
    expect(screen.getByText('error: agent-2')).toBeInTheDocument()
    expect(screen.getByText('spawn: agent-3')).toBeInTheDocument()
  })

  it('re-fetches dashboard data on polling interval', async () => {
    render(<DashboardView />)

    // Flush the initial useBackoffInterval tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(window.api.dashboard.completionsPerHour).toHaveBeenCalledTimes(1)

    // Advance past the 60s polling interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(window.api.dashboard.completionsPerHour).toHaveBeenCalledTimes(2)
    expect(window.api.dashboard.recentEvents).toHaveBeenCalledTimes(2)
    expect(window.api.getPrList).toHaveBeenCalledTimes(2)
  })

  it('logs errors instead of swallowing them', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(window.api.dashboard.completionsPerHour).mockRejectedValueOnce(
      new Error('Network error')
    )

    render(<DashboardView />)

    // Flush initial useBackoffInterval tick to trigger the rejected promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      '[Dashboard] Failed to fetch completions:',
      expect.any(Error)
    )

    consoleSpy.mockRestore()
  })

  it('renders correct PR count from getPrList payload', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [
        {
          number: 1,
          title: 'PR1',
          html_url: '',
          state: 'open',
          draft: false,
          created_at: '',
          updated_at: '',
          head: { ref: 'a', sha: 'b' },
          base: { ref: 'main' },
          user: { login: 'u' },
          merged: false,
          merged_at: null,
          repo: 'r'
        },
        {
          number: 2,
          title: 'PR2',
          html_url: '',
          state: 'open',
          draft: false,
          created_at: '',
          updated_at: '',
          head: { ref: 'c', sha: 'd' },
          base: { ref: 'main' },
          user: { login: 'u' },
          merged: false,
          merged_at: null,
          repo: 'r'
        }
      ],
      checks: {}
    })
    render(<DashboardView />)
    // Flush initial useBackoffInterval tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
