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
      totalTokens: 0,
      fetchLocalAgents: vi.fn().mockResolvedValue(undefined)
    })
  )
}))

vi.mock('../../stores/dashboardData', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    throughputData: [],
    loadData: null,
    feedEvents: [],
    prCount: 0,
    cardErrors: {},
    loading: false,
    fetchAll: mockFetchAll,
    fetchLoad: vi.fn()
  }))
  return { useDashboardDataStore: store }
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
      throughputData: [],
      loadData: null,
      feedEvents: [],
      prCount: 0,
      successTrendData: [],
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

  it('renders stat rail for key metrics', () => {
    render(<DashboardView />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    // Done label is in a div with subtext siblings — query by role
    expect(screen.getAllByRole('button', { name: /done/i }).length).toBeGreaterThan(0)
    // Tokens 24h appears in both StatusRail and ActivitySection
    expect(screen.getAllByText('Tokens 24h').length).toBeGreaterThan(0)
  })

  it('renders pipeline and token sections', () => {
    render(<DashboardView />)
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Throughput · last 24h')).toBeInTheDocument()
  })

  it('clicking Active rail tile navigates to Sprint with in-progress filter', () => {
    render(<DashboardView />)
    const activeStat = screen.getByText('Active').closest('button')!
    fireEvent.click(activeStat)

    expect(useSprintUI.getState().statusFilter).toBe('in-progress')
    expect(usePanelLayoutStore.getState().activeView).toBe('sprint')
  })

  it('clicking Done rail tile navigates to Sprint with done filter', () => {
    render(<DashboardView />)
    // Done tile is a button with data-role="rail-tile"
    const doneTiles = screen.getAllByRole('button', { name: /done/i })
    // Find the rail tile (not the pipeline stage button)
    const doneTile = doneTiles.find((el) => el.getAttribute('data-role') === 'rail-tile')!
    fireEvent.click(doneTile)

    expect(useSprintUI.getState().statusFilter).toBe('done')
    expect(usePanelLayoutStore.getState().activeView).toBe('sprint')
  })

  it('renders chart data from completionsPerHour', () => {
    useDashboardDataStore.setState({
      throughputData: [
        { hour: '10:00', successCount: 4, failedCount: 1 },
        { hour: '11:00', successCount: 2, failedCount: 1 }
      ],
      loading: false
    })
    render(<DashboardView />)
    expect(screen.getByText('Throughput · last 24h')).toBeInTheDocument()
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

  it('renders correct PR count from awaitingReview partition', () => {
    vi.mocked(useSprintTasks).mockImplementation((selector: any) =>
      selector({
        tasks: [
          { id: '1', status: 'review', title: 'T1' },
          { id: '2', status: 'active', pr_status: 'open', title: 'T2' }
        ],
        loading: false,
        loadData: vi.fn()
      })
    )
    render(<DashboardView />)
    // PRs counter should show 2 (from awaitingReview partition: 1 review + 1 active with pr)
    // Review counter should show 1 (only status='review' tasks)
    // Active counter also shows 1 (the active task)
    expect(screen.getAllByText('2').length).toBeGreaterThan(0) // PRs shows 2
    expect(screen.getAllByText('1').length).toBeGreaterThan(0) // Review and Active both show 1
  })

  // ---------- Branch coverage: tokens/run card ----------

  it('shows dash when no token data available', () => {
    render(<DashboardView />)
    // tokenAvg is null, should show '—' in tokens/run card
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows success rate chart card', () => {
    render(<DashboardView />)
    expect(screen.getByText('Success rate · last 14d')).toBeInTheDocument()
  })

  it('shows system load chart card', () => {
    render(<DashboardView />)
    expect(screen.getByText('System load · last 10m')).toBeInTheDocument()
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
          {
            id: '1',
            status: 'done',
            title: 'Implement feature X',
            completed_at: new Date().toISOString()
          }
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
        throughput: 'Failed to load completions',
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
        throughput: 'Failed to load completions',
        feed: 'Failed to load activity feed',
        prs: 'Failed to load PR data'
      },
      loading: false
    })

    render(<DashboardView />)

    // Click the first retry button (throughput card)
    const retryBtns = screen.getAllByText('Retry')
    fireEvent.click(retryBtns[0])

    expect(mockFetchAll).toHaveBeenCalled()
  })

  // ---------- Branch coverage: loading state ----------

  it('shows Loading... text during initial load with no throughput data', () => {
    useDashboardDataStore.setState({
      loading: true,
      throughputData: []
    })
    render(<DashboardView />)
    // Multiple "Loading..." elements may appear (status bar + load card)
    expect(screen.getAllByText('Loading...').length).toBeGreaterThan(0)
  })

  // ---------- Branch coverage: clicking Queued and PRs stats ----------

  it('clicking Queued rail tile navigates to Sprint with todo filter', () => {
    render(<DashboardView />)
    const queuedElements = screen.getAllByText('Queued')
    const queuedStat = queuedElements.find((el) => el.closest('button'))!.closest('button')!
    fireEvent.click(queuedStat)

    expect(useSprintUI.getState().statusFilter).toBe('todo')
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

  // ---------- Branch coverage: fires strip ----------

  it('shows fires strip when there are failed tasks', () => {
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
    expect(screen.getByRole('region', { name: 'Dashboard alerts' })).toBeInTheDocument()
    expect(screen.getByText('1 failed')).toBeInTheDocument()
  })

  it('does not show fires strip when no issues', () => {
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
    expect(screen.queryByRole('region', { name: 'Dashboard alerts' })).not.toBeInTheDocument()
  })

  // ---------- Branch coverage: cost trend data ----------

  it('renders token trend chart with agent data', () => {
    vi.mocked(useCostDataStore).mockImplementation((selector: any) =>
      selector({
        localAgents: [
          {
            id: 'a1',
            durationMs: 60000,
            tokensIn: 30000,
            tokensOut: 5000,
            startedAt: new Date().toISOString(),
            taskTitle: 'Task A'
          },
          {
            id: 'a2',
            durationMs: 120000,
            tokensIn: 60000,
            tokensOut: 10000,
            startedAt: new Date().toISOString(),
            taskTitle: 'Task B'
          }
        ],
        totalTokens: 105000,
        fetchLocalAgents: vi.fn()
      })
    )
    render(<DashboardView />)
    expect(screen.getByText(/2 runs · avg/)).toBeInTheDocument()
  })
})
