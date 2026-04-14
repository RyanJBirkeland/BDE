import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDashboardDataStore } from '../dashboardData'

const mockLoadAverage = vi.fn()

// Inject system mock into the global window.api stub
;(window.api as any).system = { loadAverage: mockLoadAverage }

describe('dashboardDataStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mocks to default values
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.dashboard.dailySuccessRate as any).mockResolvedValue([])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })
    mockLoadAverage.mockResolvedValue({ samples: [], cpuCount: 8 })

    // Reset store to initial state
    useDashboardDataStore.setState({
      throughputData: [],
      loadData: null,
      feedEvents: [],
      prCount: 0,
      successTrendData: [],
      cardErrors: {},
      loading: true
    })
  })

  it('has correct default state', () => {
    const state = useDashboardDataStore.getState()
    expect(state.throughputData).toEqual([])
    expect(state.loadData).toBeNull()
    expect(state.feedEvents).toEqual([])
    expect(state.prCount).toBe(0)
    expect(state.cardErrors).toEqual({})
    expect(state.loading).toBe(true)
  })

  it('store no longer exposes burndownData', () => {
    const s = useDashboardDataStore.getState()
    expect((s as unknown as Record<string, unknown>).burndownData).toBeUndefined()
  })

  it('fetchAll populates throughputData with hour/success/failed', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([
      { hour: '2026-04-07T14:00:00', successCount: 3, failedCount: 1 }
    ])
    await useDashboardDataStore.getState().fetchAll()
    const s = useDashboardDataStore.getState()
    expect(s.throughputData).toEqual([
      { hour: '2026-04-07T14:00:00', successCount: 3, failedCount: 1 }
    ])
  })

  it('fetchAll populates all fields on success', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([
      { hour: '10:00', successCount: 4, failedCount: 1 },
      { hour: '11:00', successCount: 2, failedCount: 1 }
    ])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([
      {
        id: 1,
        agent_id: 'a1',
        event_type: 'agent:completed',
        payload: '{}',
        timestamp: 1000,
        task_title: 'Fix auth'
      },
      {
        id: 2,
        agent_id: 'a2',
        event_type: 'agent:error',
        payload: '{}',
        timestamp: 2000,
        task_title: null
      }
    ])
    ;(window.api.pr.getList as any).mockResolvedValue({
      prs: [{ number: 1 }, { number: 2 }, { number: 3 }]
    })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.loading).toBe(false)
    expect(state.throughputData).toHaveLength(2)
    expect(state.throughputData[0]).toEqual({ hour: '10:00', successCount: 4, failedCount: 1 })
    expect(state.throughputData[1]).toEqual({ hour: '11:00', successCount: 2, failedCount: 1 })
    expect(state.feedEvents).toHaveLength(2)
    expect(state.feedEvents[0]).toEqual({
      id: '1',
      label: 'Task Fix auth completed',
      accent: 'cyan',
      timestamp: 1000
    })
    expect(state.feedEvents[1]).toEqual({
      id: '2',
      label: 'failed',
      accent: 'red',
      timestamp: 2000
    })
    expect(state.prCount).toBe(3)
    expect(state.cardErrors).toEqual({})
  })

  it('fetchAll sets cardErrors on partial failure', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockRejectedValue(new Error('network'))
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.loading).toBe(false)
    expect(state.cardErrors.throughput).toBe('Failed to load completions')
    expect(state.cardErrors.feed).toBeUndefined()
    expect(state.cardErrors.prs).toBeUndefined()
    expect(state.throughputData).toEqual([])
  })

  it('fetchAll clears previous errors on success', async () => {
    // First call: set errors
    ;(window.api.dashboard.completionsPerHour as any).mockRejectedValue(new Error('fail'))
    ;(window.api.dashboard.recentEvents as any).mockRejectedValue(new Error('fail'))
    ;(window.api.pr.getList as any).mockRejectedValue(new Error('fail'))

    await useDashboardDataStore.getState().fetchAll()
    expect(Object.keys(useDashboardDataStore.getState().cardErrors).length).toBeGreaterThan(0)

    // Second call: all succeed
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    // fetchAll only owns its own keys — loadAverage key (if any) would be preserved
    expect(state.cardErrors.throughput).toBeUndefined()
    expect(state.cardErrors.feed).toBeUndefined()
    expect(state.cardErrors.prs).toBeUndefined()
    expect(state.cardErrors.successTrend).toBeUndefined()
  })

  it('fetchAll preserves loadAverage error when it clears its own errors', async () => {
    // Simulate loadAverage error already set
    useDashboardDataStore.setState({ cardErrors: { loadAverage: 'Failed to load system metrics' } })
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    // loadAverage error should still be there — fetchAll does not own it
    expect(state.cardErrors.loadAverage).toBe('Failed to load system metrics')
  })

  it('fetchAll sets loading false after completion', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })

    expect(useDashboardDataStore.getState().loading).toBe(true)

    await useDashboardDataStore.getState().fetchAll()

    expect(useDashboardDataStore.getState().loading).toBe(false)
  })

  it('fetchAll handles null/undefined API responses gracefully', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue(null)
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue(null)
    ;(window.api.pr.getList as any).mockResolvedValue(null)

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.throughputData).toEqual([])
    expect(state.feedEvents).toEqual([])
    expect(state.prCount).toBe(0)
    expect(state.loading).toBe(false)
  })

  it('fetchAll maps unknown event types to purple accent', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([
      {
        id: 10,
        agent_id: 'x',
        event_type: 'unknown_type',
        payload: '{}',
        timestamp: 500,
        task_title: null
      }
    ])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const event = useDashboardDataStore.getState().feedEvents[0]
    expect(event.accent).toBe('purple')
    expect(event.label).toBe('unknown_type')
  })

  it('fetchAll filters out noisy events (text, tool_call, tool_result)', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([
      {
        id: 1,
        agent_id: 'a1',
        event_type: 'agent:text',
        payload: '{}',
        timestamp: 1000,
        task_title: null
      },
      {
        id: 2,
        agent_id: 'a1',
        event_type: 'agent:tool_call',
        payload: '{}',
        timestamp: 2000,
        task_title: null
      },
      {
        id: 3,
        agent_id: 'a1',
        event_type: 'agent:completed',
        payload: '{}',
        timestamp: 3000,
        task_title: 'Fix bug'
      }
    ])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const events = useDashboardDataStore.getState().feedEvents
    // Only the 'agent:completed' event should remain
    expect(events).toHaveLength(1)
    expect(events[0].label).toBe('Task Fix bug completed')
  })

  it('fetchAll formats labels with task title when available', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([
      {
        id: 1,
        agent_id: 'a1',
        event_type: 'agent:started',
        payload: '{}',
        timestamp: 1000,
        task_title: 'Add feature'
      },
      {
        id: 2,
        agent_id: 'a2',
        event_type: 'agent:completed',
        payload: '{}',
        timestamp: 2000,
        task_title: null
      }
    ])
    ;(window.api.pr.getList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const events = useDashboardDataStore.getState().feedEvents
    expect(events).toHaveLength(2)
    expect(events[0].label).toBe('Task Add feature started')
    expect(events[1].label).toBe('completed')
  })

  // ---------- fetchLoad tests ----------

  it('fetchLoad populates loadData from system.loadAverage', async () => {
    mockLoadAverage.mockResolvedValue({
      samples: [{ t: 1, load1: 2, load5: 3, load15: 4 }],
      cpuCount: 8
    })
    await useDashboardDataStore.getState().fetchLoad()
    expect(useDashboardDataStore.getState().loadData).toEqual({
      samples: [{ t: 1, load1: 2, load5: 3, load15: 4 }],
      cpuCount: 8
    })
  })

  it('fetchLoad sets cardErrors.loadAverage on failure', async () => {
    mockLoadAverage.mockRejectedValue(new Error('boom'))
    await useDashboardDataStore.getState().fetchLoad()
    expect(useDashboardDataStore.getState().cardErrors.loadAverage).toBeDefined()
  })

  it('fetchLoad clears cardErrors.loadAverage on success after failure', async () => {
    mockLoadAverage.mockRejectedValueOnce(new Error('boom'))
    await useDashboardDataStore.getState().fetchLoad()
    expect(useDashboardDataStore.getState().cardErrors.loadAverage).toBeDefined()
    mockLoadAverage.mockResolvedValueOnce({ samples: [], cpuCount: 8 })
    await useDashboardDataStore.getState().fetchLoad()
    expect(useDashboardDataStore.getState().cardErrors.loadAverage).toBeUndefined()
  })
})
