import { create } from 'zustand'
import type { CompletionBucket, LoadSnapshot } from '../../../shared/ipc-channels'
import type { FeedEvent } from '../lib/dashboard-types'
import {
  getCompletionsPerHour,
  getRecentEvents,
  getPrList,
  getDailySuccessRate,
  getLoadAverage
} from '../services/dashboard'

interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

interface DashboardDataState {
  throughputData: CompletionBucket[]
  loadData: LoadSnapshot | null
  feedEvents: FeedEvent[]
  prCount: number
  successTrendData: DailySuccessRate[]
  cardErrors: Record<string, string | undefined>
  loading: boolean
  lastFetchedAt: number | null
  fetchAll: () => Promise<void>
  fetchLoad: () => Promise<void>
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
 * Maps eventType to human-readable action phrase.
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

/**
 * Merge card errors from a fetch that owns a specific set of keys.
 * Keys owned by this fetch are cleared first, then new errors are applied.
 * Keys owned by other fetches (e.g., loadAverage from fetchLoad) are preserved.
 */
function mergeCardErrors(
  prev: Record<string, string | undefined>,
  incoming: Record<string, string>,
  keysThisFetchOwns: string[]
): Record<string, string | undefined> {
  const next = { ...prev }
  for (const k of keysThisFetchOwns) delete next[k]
  Object.assign(next, incoming)
  return next
}

export const useDashboardDataStore = create<DashboardDataState>((set) => ({
  throughputData: [],
  loadData: null,
  feedEvents: [],
  prCount: 0,
  successTrendData: [],
  cardErrors: {},
  loading: true,
  lastFetchedAt: null,

  fetchAll: async () => {
    const errors: Record<string, string> = {}

    let throughputData: CompletionBucket[] = []
    try {
      const data = await getCompletionsPerHour()
      if (data) throughputData = data
    } catch {
      errors.throughput = 'Failed to load completions'
    }

    let feedEvents: FeedEvent[] = []
    try {
      const events = await getRecentEvents(30)
      if (events) {
        feedEvents = events
          .map((e) => {
            const action = formatEventAction(e.eventType)
            // Filter out noisy events (text, tool calls, etc.)
            if (action === null) return null

            const label = e.taskTitle ? `Task ${e.taskTitle} ${action}` : action

            return {
              id: String(e.id),
              label,
              accent: EVENT_ACCENT[e.eventType] ?? ('purple' as const),
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
      const prs = await getPrList()
      prCount = prs?.prs?.length ?? 0
    } catch {
      errors.prs = 'Failed to load PR data'
    }

    let successTrendData: DailySuccessRate[] = []
    try {
      const data = await getDailySuccessRate(14)
      if (data) {
        successTrendData = data
      }
    } catch {
      errors.successTrend = 'Failed to load success trend'
    }

    set((state) => ({
      throughputData,
      feedEvents,
      prCount,
      successTrendData,
      cardErrors: mergeCardErrors(state.cardErrors, errors, [
        'throughput',
        'successTrend',
        'feed',
        'prs'
      ]),
      loading: false,
      lastFetchedAt: Date.now()
    }))
  },

  fetchLoad: async () => {
    try {
      const data = await getLoadAverage()
      if (data) {
        set((state) => {
          const nextErrors = { ...state.cardErrors }
          delete nextErrors.loadAverage
          return { loadData: data, cardErrors: nextErrors }
        })
      }
    } catch {
      set((state) => ({
        cardErrors: { ...state.cardErrors, loadAverage: 'Failed to load system metrics' }
      }))
    }
  }
}))
