import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getCompletionsPerHour,
  getRecentEvents,
  getPrList,
  getDailySuccessRate,
  getLoadAverage
} from '../dashboard'

describe('dashboard service', () => {
  beforeEach(() => {
    vi.mocked(window.api.dashboard?.completionsPerHour).mockResolvedValue([])
    vi.mocked(window.api.dashboard?.recentEvents).mockResolvedValue([])
    vi.mocked(window.api.pr.getList).mockResolvedValue({ prs: [], checks: {} })
    vi.mocked(window.api.dashboard?.dailySuccessRate).mockResolvedValue([])
    vi.mocked(window.api.system?.loadAverage).mockResolvedValue({ samples: [], cpuCount: 8 })
  })

  it('getCompletionsPerHour delegates to window.api.dashboard.completionsPerHour', async () => {
    await getCompletionsPerHour()
    expect(window.api.dashboard?.completionsPerHour).toHaveBeenCalled()
  })

  it('getRecentEvents passes count', async () => {
    await getRecentEvents(30)
    expect(window.api.dashboard?.recentEvents).toHaveBeenCalledWith(30)
  })

  it('getPrList delegates to window.api.pr.getList', async () => {
    await getPrList()
    expect(window.api.pr.getList).toHaveBeenCalled()
  })

  it('getDailySuccessRate passes days', async () => {
    await getDailySuccessRate(14)
    expect(window.api.dashboard?.dailySuccessRate).toHaveBeenCalledWith(14)
  })

  it('getLoadAverage delegates to window.api.system.loadAverage', async () => {
    await getLoadAverage()
    expect(window.api.system?.loadAverage).toHaveBeenCalled()
  })
})
