import { create } from 'zustand'
import type { ChartBar } from '../components/neon/MiniChart'
import type { FeedEvent } from '../components/neon/ActivityFeed'

interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

interface DashboardDataState {
  chartData: ChartBar[]
  burndownData: ChartBar[]
  feedEvents: FeedEvent[]
  prCount: number
  successTrendData: DailySuccessRate[]
  cardErrors: Record<string, string | undefined>
  loading: boolean
  lastFetchedAt: number | null
  fetchAll: () => Promise<void>
}

const EVENT_ACCENT: Record<string, FeedEvent['accent']> = {
  'agent:error': 'red',
  'agent:completed': 'cyan',
  'agent:started': 'blue',
  // Legacy format support
  error: 'red',
  complete: 'cyan'
}

/**
 * Maps event_type to human-readable action phrase.
 * Returns null for noisy events that shouldn't appear in the feed.
 */
function formatEventAction(eventType: string): string | null {
  switch (eventType) {
    case 'agent:completed':
      return 'completed'
    case 'agent:error':
      return 'failed'
    case 'agent:started':
      return 'started'
    case 'agent:text':
    case 'agent:tool_call':
    case 'agent:tool_result':
      // Too noisy for activity feed
      return null
    default:
      // Unknown event types: show raw type
      return eventType
  }
}

export const useDashboardDataStore = create<DashboardDataState>((set) => ({
  chartData: [],
  burndownData: [],
  feedEvents: [],
  prCount: 0,
  successTrendData: [],
  cardErrors: {},
  loading: true,
  lastFetchedAt: null,

  fetchAll: async () => {
    const errors: Record<string, string> = {}

    let chartData: ChartBar[] = []
    try {
      const data = await window.api.dashboard?.completionsPerHour()
      if (data) {
        chartData = data.map((d) => ({
          value: d.count,
          accent: 'cyan' as const,
          label: d.hour
        }))
      }
    } catch {
      errors.chart = 'Failed to load completions'
    }

    let burndownData: ChartBar[] = []
    try {
      const data = await window.api.dashboard?.burndown()
      if (data) {
        burndownData = data.map((d) => ({
          value: d.count,
          accent: 'cyan' as const,
          label: d.date
        }))
      }
    } catch {
      errors.burndown = 'Failed to load burndown'
    }

    let feedEvents: FeedEvent[] = []
    try {
      const events = await window.api.dashboard?.recentEvents(30)
      if (events) {
        feedEvents = events
          .map((e) => {
            const action = formatEventAction(e.event_type)
            // Filter out noisy events (text, tool calls, etc.)
            if (action === null) return null

            const label = e.task_title ? `Task ${e.task_title} ${action}` : action

            return {
              id: String(e.id),
              label,
              accent: EVENT_ACCENT[e.event_type] ?? ('purple' as const),
              timestamp: e.timestamp
            }
          })
          .filter((e): e is FeedEvent => e !== null)
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

    let successTrendData: DailySuccessRate[] = []
    try {
      const data = await window.api.dashboard?.dailySuccessRate(14)
      if (data) {
        successTrendData = data
      }
    } catch {
      errors.successTrend = 'Failed to load success trend'
    }

    set({
      chartData,
      burndownData,
      feedEvents,
      prCount,
      successTrendData,
      cardErrors: Object.keys(errors).length > 0 ? errors : {},
      loading: false,
      lastFetchedAt: Date.now()
    })
  }
}))
