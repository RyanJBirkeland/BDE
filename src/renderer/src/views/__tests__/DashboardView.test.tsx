import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFetchAll } = vi.hoisted(() => ({ mockFetchAll: vi.fn() }))

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      tasks: [{ id: 'seed-1', status: 'queued', title: 'Seed task' }],
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

vi.mock('../../stores/dashboardData', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    chartData: [],
    feedEvents: [],
    prCount: 0,
    cardErrors: {},
    loading: false,
    fetchAll: mockFetchAll
  }))
  return { useDashboardDataStore: store }
})

vi.mock('../../components/neon', async () => {
  const actual =
    await vi.importActual<typeof import('../../components/neon')>('../../components/neon')
  return {
    ...actual,
    ScanlineOverlay: () => null,
    ParticleField: () => null
  }
})

// ---------------------------------------------------------------------------
// Subject + stores
// ---------------------------------------------------------------------------

import DashboardView from '../DashboardView'
import { useDashboardDataStore } from '../../stores/dashboardData'
import { useSprintUI } from '../../stores/sprintUI'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCostDataStore } from '../../stores/costData'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    useSprintUI.setState({ searchQuery: '', statusFilter: 'all' })
    useDashboardDataStore.setState({
      chartData: [],
      feedEvents: [],
      prCount: 0,
      cardErrors: {},
      loading: false,
      fetchAll: mockFetchAll
    })
  })

  afterEach(() => {
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
    expect(screen.getByText('Cost 24h')).toBeInTheDocument()
  })

  it('clicking Active stat navigates to Sprint with in-progress filter', () => {
    render(<DashboardView />)
    const activeStat = screen.getByText('Active').closest('[role="button"]')!
    fireEvent.click(activeStat)

    expect(useSprintUI.getState().statusFilter).toBe('in-progress')
    expect(usePanelLayoutStore.getState().activeView).toBe('sprint')
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
    expect(usePanelLayoutStore.getState().activeView).toBe('sprint')
  })

  it('clicking Blocked stat navigates to Sprint with blocked filter', () => {
    render(<DashboardView />)
    const blockedElements = screen.getAllByText('Blocked')
    const blockedStat = blockedElements
      .find((el) => el.closest('[role="button"]'))!
      .closest('[role="button"]')!
    fireEvent.click(blockedStat)

    expect(useSprintUI.getState().statusFilter).toBe('blocked')
    expect(usePanelLayoutStore.getState().activeView).toBe('sprint')
  })

  it('renders chart data from completionsPerHour', () => {
    useDashboardDataStore.setState({
      chartData: [
        { value: 5, accent: 'cyan', label: '10:00' },
        { value: 3, accent: 'pink', label: '11:00' }
      ],
      loading: false
    })
    render(<DashboardView />)
    expect(screen.getByText('Completions by Hour')).toBeInTheDocument()
  })

  it('renders feed events from recentEvents', () => {
    useDashboardDataStore.setState({
      feedEvents: [
        { id: '1', label: 'complete: agent-1', accent: 'cyan', timestamp: Date.now() - 5000 },
        { id: '2', label: 'error: agent-2', accent: 'red', timestamp: Date.now() - 10000 },
        { id: '3', label: 'spawn: agent-3', accent: 'purple', timestamp: Date.now() - 20000 }
      ],
      loading: false
    })
    render(<DashboardView />)
    expect(screen.getByText('complete: agent-1')).toBeInTheDocument()
    expect(screen.getByText('error: agent-2')).toBeInTheDocument()
    expect(screen.getByText('spawn: agent-3')).toBeInTheDocument()
  })

  it('renders correct PR count from store', () => {
    useDashboardDataStore.setState({
      prCount: 2,
      loading: false
    })
    render(<DashboardView />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  // ---------- Branch coverage: SuccessRing (rate null vs values) ----------

  it('shows "No terminal tasks" when no done/failed tasks', () => {
    render(<DashboardView />)
    expect(screen.getByText('No terminal tasks')).toBeInTheDocument()
  })

  it('shows success ring with percentage when done tasks exist', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [
          { id: '1', status: 'done', title: 'T1', completed_at: new Date().toISOString() },
          { id: '2', status: 'done', title: 'T2', completed_at: new Date().toISOString() },
          { id: '3', status: 'failed', title: 'T3' }
        ],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    // 2 done, 1 failed = 67%
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText(/2✓/)).toBeInTheDocument()
    expect(screen.getByText(/1✗/)).toBeInTheDocument()
  })

  it('shows success ring with high rate (>=80) cyan accent', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [
          { id: '1', status: 'done', title: 'T1', completed_at: new Date().toISOString() },
          { id: '2', status: 'done', title: 'T2', completed_at: new Date().toISOString() },
          { id: '3', status: 'done', title: 'T3', completed_at: new Date().toISOString() },
          { id: '4', status: 'done', title: 'T4', completed_at: new Date().toISOString() },
          { id: '5', status: 'failed', title: 'T5' }
        ],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  // ---------- Branch coverage: avgDuration (null vs value) ----------

  it('shows dash when no agent durations available', () => {
    render(<DashboardView />)
    // avgDuration is null, should show '—'
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows formatted duration when agent runs have duration', () => {
    vi.mocked(useCostDataStore).mockImplementation((selector: any) =>
      selector({
        localAgents: [
          { id: 'a1', durationMs: 120000, costUsd: 0.5, startedAt: new Date().toISOString(), taskTitle: 'T1' },
          { id: 'a2', durationMs: 180000, costUsd: 0.3, startedAt: new Date().toISOString(), taskTitle: 'T2' }
        ],
        totalCost: 0.8,
        fetchLocalAgents: vi.fn()
      })
    )
    render(<DashboardView />)
    // avg = 150000ms = 150s = 2m 30s
    expect(screen.getByText('2m 30s')).toBeInTheDocument()
    expect(screen.getByText('2 runs tracked')).toBeInTheDocument()
  })

  it('shows hours in duration for long runs', () => {
    vi.mocked(useCostDataStore).mockImplementation((selector: any) =>
      selector({
        localAgents: [
          { id: 'a1', durationMs: 7200000, costUsd: 1.0, startedAt: new Date().toISOString(), taskTitle: 'T1' }
        ],
        totalCost: 1.0,
        fetchLocalAgents: vi.fn()
      })
    )
    render(<DashboardView />)
    // 7200000ms = 2h 0m
    expect(screen.getByText('2h 0m')).toBeInTheDocument()
  })

  it('shows seconds for short durations', () => {
    vi.mocked(useCostDataStore).mockImplementation((selector: any) =>
      selector({
        localAgents: [
          { id: 'a1', durationMs: 45000, costUsd: 0.1, startedAt: new Date().toISOString(), taskTitle: 'T1' }
        ],
        totalCost: 0.1,
        fetchLocalAgents: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.getByText('45s')).toBeInTheDocument()
  })

  // ---------- Branch coverage: recentCompletions ----------

  it('renders Recent Completions card', () => {
    render(<DashboardView />)
    expect(screen.getByText('Recent Completions')).toBeInTheDocument()
  })

  it('shows recent completions when done tasks exist', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [
          { id: '1', status: 'done', title: 'Implement feature X', completed_at: new Date().toISOString() }
        ],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.getByText('Implement feature X')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  // ---------- Branch coverage: error states with retry ----------

  it('shows error state with retry button when all fetches fail', () => {
    useDashboardDataStore.setState({
      cardErrors: {
        chart: 'Failed to load completions',
        feed: 'Failed to load activity feed',
        prs: 'Failed to load PR data'
      },
      loading: false
    })

    render(<DashboardView />)

    const retryBtns = screen.getAllByText('Retry')
    expect(retryBtns.length).toBeGreaterThanOrEqual(1)
  })

  it('retries fetching data when Retry button clicked', () => {
    useDashboardDataStore.setState({
      cardErrors: {
        chart: 'Failed to load completions',
        feed: 'Failed to load activity feed',
        prs: 'Failed to load PR data'
      },
      loading: false
    })

    render(<DashboardView />)

    // Click the first retry button (chart card)
    const retryBtns = screen.getAllByText('Retry')
    fireEvent.click(retryBtns[0])

    expect(mockFetchAll).toHaveBeenCalled()
  })

  // ---------- Branch coverage: loading state ----------

  it('shows Loading... text during initial load with no chart data', () => {
    useDashboardDataStore.setState({
      loading: true,
      chartData: []
    })
    render(<DashboardView />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  // ---------- Branch coverage: clicking Queued and PRs stats ----------

  it('clicking Queued stat navigates to Sprint with todo filter', () => {
    render(<DashboardView />)
    const queuedElements = screen.getAllByText('Queued')
    const queuedStat = queuedElements
      .find((el) => el.closest('[role="button"]'))!
      .closest('[role="button"]')!
    fireEvent.click(queuedStat)

    expect(useSprintUI.getState().statusFilter).toBe('todo')
    expect(usePanelLayoutStore.getState().activeView).toBe('sprint')
  })

  it('clicking PRs stat navigates to Sprint with awaiting-review filter', () => {
    render(<DashboardView />)
    const prsElements = screen.getAllByText('PRs')
    const prsStat = prsElements
      .find((el) => el.closest('[role="button"]'))!
      .closest('[role="button"]')!
    fireEvent.click(prsStat)

    expect(useSprintUI.getState().statusFilter).toBe('awaiting-review')
    expect(usePanelLayoutStore.getState().activeView).toBe('sprint')
  })

  // ---------- Branch coverage: onboarding state ----------

  it('shows onboarding card when no tasks exist', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.getByText('Welcome to BDE')).toBeInTheDocument()
    expect(screen.getByText('Create First Task')).toBeInTheDocument()
  })

  it('clicking Create First Task navigates to task workbench', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    fireEvent.click(screen.getByText('Create First Task'))
    expect(usePanelLayoutStore.getState().activeView).toBe('task-workbench')
  })

  // ---------- Branch coverage: attention card ----------

  it('shows attention card when there are failed tasks', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [
          { id: '1', status: 'failed', title: 'Broken task' },
          { id: '2', status: 'queued', title: 'Other task' }
        ],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.getByText('Attention')).toBeInTheDocument()
    expect(screen.getByText('1 failed task')).toBeInTheDocument()
  })

  it('does not show attention card when no issues', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [
          { id: '1', status: 'done', title: 'Done task', completed_at: new Date().toISOString() }
        ],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.queryByText('Attention')).not.toBeInTheDocument()
  })

  // ---------- Branch coverage: cost trend data ----------

  it('renders cost trend chart with agent data', () => {
    vi.mocked(useCostDataStore).mockImplementation((selector: any) =>
      selector({
        localAgents: [
          { id: 'a1', durationMs: 60000, costUsd: 0.5, startedAt: new Date().toISOString(), taskTitle: 'Task A' },
          { id: 'a2', durationMs: 120000, costUsd: 1.2, startedAt: new Date().toISOString(), taskTitle: 'Task B' }
        ],
        totalCost: 1.7,
        fetchLocalAgents: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.getByText(/last 2 runs/)).toBeInTheDocument()
    expect(screen.getByText('$1.70')).toBeInTheDocument()
  })
})
