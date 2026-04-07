import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDashboardDataStore } from '../dashboardData'

describe('dashboardDataStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mocks to default values
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.burndown as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.dashboard.dailySuccessRate as any).mockResolvedValue([])
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    // Reset store to initial state
    useDashboardDataStore.setState({
      chartData: [],
      burndownData: [],
      feedEvents: [],
      prCount: 0,
      successTrendData: [],
      cardErrors: {},
      loading: true
    })
  })

  it('has correct default state', () => {
    const state = useDashboardDataStore.getState()
    expect(state.chartData).toEqual([])
    expect(state.burndownData).toEqual([])
    expect(state.feedEvents).toEqual([])
    expect(state.prCount).toBe(0)
    expect(state.cardErrors).toEqual({})
    expect(state.loading).toBe(true)
  })

  it('fetchAll populates all fields on success', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([
      { hour: '10:00', successCount: 4, failedCount: 1 },
      { hour: '11:00', successCount: 2, failedCount: 1 }
    ])
    ;(window.api.dashboard.burndown as any).mockResolvedValue([
      { date: '2026-03-28', count: 2 },
      { date: '2026-03-29', count: 4 }
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
    ;(window.api.getPrList as any).mockResolvedValue({
      prs: [{ number: 1 }, { number: 2 }, { number: 3 }]
    })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.loading).toBe(false)
    expect(state.chartData).toHaveLength(2)
    expect(state.chartData[0]).toEqual({ value: 5, accent: 'cyan', label: '10:00' })
    expect(state.chartData[1]).toEqual({ value: 3, accent: 'cyan', label: '11:00' })
    // value = successCount + failedCount (temporary bridge until Task 5)
    expect(state.burndownData).toHaveLength(2)
    expect(state.burndownData[0]).toEqual({ value: 2, accent: 'cyan', label: '2026-03-28' })
    expect(state.burndownData[1]).toEqual({ value: 4, accent: 'cyan', label: '2026-03-29' })
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
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.loading).toBe(false)
    expect(state.cardErrors.chart).toBe('Failed to load completions')
    expect(state.cardErrors.feed).toBeUndefined()
    expect(state.cardErrors.prs).toBeUndefined()
    expect(state.chartData).toEqual([])
  })

  it('fetchAll clears previous errors on success', async () => {
    // First call: set errors
    ;(window.api.dashboard.completionsPerHour as any).mockRejectedValue(new Error('fail'))
    ;(window.api.dashboard.burndown as any).mockRejectedValue(new Error('fail'))
    ;(window.api.dashboard.recentEvents as any).mockRejectedValue(new Error('fail'))
    ;(window.api.getPrList as any).mockRejectedValue(new Error('fail'))

    await useDashboardDataStore.getState().fetchAll()
    expect(Object.keys(useDashboardDataStore.getState().cardErrors).length).toBeGreaterThan(0)

    // Second call: all succeed
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.burndown as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.cardErrors).toEqual({})
  })

  it('fetchAll sets loading false after completion', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    expect(useDashboardDataStore.getState().loading).toBe(true)

    await useDashboardDataStore.getState().fetchAll()

    expect(useDashboardDataStore.getState().loading).toBe(false)
  })

  it('fetchAll handles null/undefined API responses gracefully', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue(null)
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue(null)
    ;(window.api.getPrList as any).mockResolvedValue(null)

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.chartData).toEqual([])
    expect(state.feedEvents).toEqual([])
    expect(state.prCount).toBe(0)
    expect(state.loading).toBe(false)
  })

  it('fetchAll maps all chart bars with cyan accent', async () => {
    const data = Array.from({ length: 7 }, (_, i) => ({ hour: `${i}:00`, successCount: i + 1, failedCount: 0 }))
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue(data)
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const accents = useDashboardDataStore.getState().chartData.map((d) => d.accent)
    expect(accents).toEqual(['cyan', 'cyan', 'cyan', 'cyan', 'cyan', 'cyan', 'cyan'])
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
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

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
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

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
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const events = useDashboardDataStore.getState().feedEvents
    expect(events).toHaveLength(2)
    expect(events[0].label).toBe('Task Add feature started')
    expect(events[1].label).toBe('completed')
  })
})
