import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDashboardDataStore } from '../dashboardData'

describe('dashboardDataStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mocks to default values
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    // Reset store to initial state
    useDashboardDataStore.setState({
      chartData: [],
      feedEvents: [],
      prCount: 0,
      cardErrors: {},
      loading: true
    })
  })

  it('has correct default state', () => {
    const state = useDashboardDataStore.getState()
    expect(state.chartData).toEqual([])
    expect(state.feedEvents).toEqual([])
    expect(state.prCount).toBe(0)
    expect(state.cardErrors).toEqual({})
    expect(state.loading).toBe(true)
  })

  it('fetchAll populates all fields on success', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([
      { hour: '10:00', count: 5 },
      { hour: '11:00', count: 3 }
    ])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([
      { id: 1, agent_id: 'a1', event_type: 'complete', payload: '{}', timestamp: 1000 },
      { id: 2, agent_id: 'a2', event_type: 'error', payload: '{}', timestamp: 2000 }
    ])
    ;(window.api.getPrList as any).mockResolvedValue({
      prs: [{ number: 1 }, { number: 2 }, { number: 3 }]
    })

    await useDashboardDataStore.getState().fetchAll()

    const state = useDashboardDataStore.getState()
    expect(state.loading).toBe(false)
    expect(state.chartData).toHaveLength(2)
    expect(state.chartData[0]).toEqual({ value: 5, accent: 'cyan', label: '10:00' })
    expect(state.chartData[1]).toEqual({ value: 3, accent: 'pink', label: '11:00' })
    expect(state.feedEvents).toHaveLength(2)
    expect(state.feedEvents[0]).toEqual({
      id: '1',
      label: 'complete: a1',
      accent: 'cyan',
      timestamp: 1000
    })
    expect(state.feedEvents[1]).toEqual({
      id: '2',
      label: 'error: a2',
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
    ;(window.api.dashboard.recentEvents as any).mockRejectedValue(new Error('fail'))
    ;(window.api.getPrList as any).mockRejectedValue(new Error('fail'))

    await useDashboardDataStore.getState().fetchAll()
    expect(Object.keys(useDashboardDataStore.getState().cardErrors).length).toBeGreaterThan(0)

    // Second call: all succeed
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
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

  it('fetchAll maps accent cycle correctly for many data points', async () => {
    const data = Array.from({ length: 7 }, (_, i) => ({ hour: `${i}:00`, count: i + 1 }))
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue(data)
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([])
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    const accents = useDashboardDataStore.getState().chartData.map((d) => d.accent)
    // Cycle repeats after 5
    expect(accents).toEqual(['cyan', 'pink', 'blue', 'orange', 'purple', 'cyan', 'pink'])
  })

  it('fetchAll maps unknown event types to purple accent', async () => {
    ;(window.api.dashboard.completionsPerHour as any).mockResolvedValue([])
    ;(window.api.dashboard.recentEvents as any).mockResolvedValue([
      { id: 10, agent_id: 'x', event_type: 'unknown_type', payload: '{}', timestamp: 500 }
    ])
    ;(window.api.getPrList as any).mockResolvedValue({ prs: [] })

    await useDashboardDataStore.getState().fetchAll()

    expect(useDashboardDataStore.getState().feedEvents[0].accent).toBe('purple')
  })
})
