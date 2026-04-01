import { create } from 'zustand'
import type { ChartBar } from '../components/neon/MiniChart'
import type { FeedEvent } from '../components/neon/ActivityFeed'

interface DashboardDataState {
  chartData: ChartBar[]
  feedEvents: FeedEvent[]
  prCount: number
  cardErrors: Record<string, string | undefined>
  loading: boolean
  lastFetchedAt: number | null
  fetchAll: () => Promise<void>
}

const ACCENT_CYCLE: ChartBar['accent'][] = ['cyan', 'pink', 'blue', 'orange', 'purple']
const EVENT_ACCENT: Record<string, FeedEvent['accent']> = {
  error: 'red',
  complete: 'cyan'
}

export const useDashboardDataStore = create<DashboardDataState>((set) => ({
  chartData: [],
  feedEvents: [],
  prCount: 0,
  cardErrors: {},
  loading: true,
  lastFetchedAt: null,

  fetchAll: async () => {
    const errors: Record<string, string> = {}

    let chartData: ChartBar[] = []
    try {
      const data = await window.api.dashboard?.completionsPerHour()
      if (data) {
        chartData = data.map((d, i) => ({
          value: d.count,
          accent: ACCENT_CYCLE[i % ACCENT_CYCLE.length],
          label: d.hour
        }))
      }
    } catch {
      errors.chart = 'Failed to load completions'
    }

    let feedEvents: FeedEvent[] = []
    try {
      const events = await window.api.dashboard?.recentEvents(30)
      if (events) {
        feedEvents = events.map((e) => ({
          id: String(e.id),
          label: `${e.event_type}: ${e.agent_id}`,
          accent: EVENT_ACCENT[e.event_type] ?? ('purple' as const),
          timestamp: e.timestamp
        }))
      }
    } catch {
      errors.feed = 'Failed to load activity feed'
    }

    let prCount = 0
    try {
      const prs = await window.api.getPrList()
      prCount = prs?.prs?.length ?? 0
    } catch {
      errors.prs = 'Failed to load PR data'
    }

    set({
      chartData,
      feedEvents,
      prCount,
      cardErrors: Object.keys(errors).length > 0 ? errors : {},
      loading: false,
      lastFetchedAt: Date.now()
    })
  }
}))
