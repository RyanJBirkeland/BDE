import { create } from 'zustand'
import type { AgentEvent } from '../../../shared/types'
import { subscribeToAgentEvents, getAgentEventHistory } from '../services/agents'

const MAX_EVENTS_PER_AGENT = 2000
const EMPTY_EVENTS: AgentEvent[] = []

let unsubscribe: (() => void) | null = null

/**
 * Merge a newly-fetched history snapshot with the live-broadcast events
 * already in the store. History is authoritative up to its query time;
 * live events may carry newer messages that haven't been flushed to SQLite
 * yet. We union the two and de-duplicate identical payloads (serialized
 * form) so a replay from SQLite doesn't produce duplicate cards. Chronology
 * is preserved by sorting on `timestamp`; `Array.prototype.sort` is stable
 * since ES2019, so events sharing a millisecond keep their emit order.
 */
function mergeHistoryWithLiveEvents(history: AgentEvent[], live: AgentEvent[]): AgentEvent[] {
  const seen = new Set<string>()
  const merged: AgentEvent[] = []
  for (const event of history.concat(live)) {
    const key = JSON.stringify(event)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(event)
  }
  merged.sort((a, b) => a.timestamp - b.timestamp)
  return merged
}

interface AgentEventsState {
  events: Record<string, AgentEvent[]>
  evictedAgents: Record<string, boolean>
  init: () => () => void
  destroy: () => void
  loadHistory: (agentId: string) => Promise<void>
  clear: (agentId: string) => void
}

/**
 * Scoped selector — subscribe to a single agent's events without
 * re-rendering when other agents receive events.
 *
 * Usage: `const events = useAgentEvents(agentId)`
 */
export function useAgentEvents(agentId: string | null): AgentEvent[] {
  return useAgentEventsStore((s) => (agentId ? (s.events[agentId] ?? EMPTY_EVENTS) : EMPTY_EVENTS))
}

export const useAgentEventsStore = create<AgentEventsState>((set) => ({
  events: {},
  evictedAgents: {},

  init() {
    if (unsubscribe) {
      return unsubscribe // already subscribed
    }
    unsubscribe = subscribeToAgentEvents(({ agentId, event }) => {
      set((state) => {
        const existing = state.events[agentId] ?? []
        const updated = [...existing, event]
        const wasEvicted = updated.length > MAX_EVENTS_PER_AGENT
        return {
          events: {
            ...state.events,
            [agentId]: wasEvicted ? updated.slice(-MAX_EVENTS_PER_AGENT) : updated
          },
          evictedAgents: wasEvicted
            ? { ...state.evictedAgents, [agentId]: true }
            : state.evictedAgents
        }
      })
    })
    return unsubscribe
  },

  destroy() {
    unsubscribe?.()
    unsubscribe = null
  },

  async loadHistory(agentId: string) {
    const history = await getAgentEventHistory(agentId)
    set((state) => {
      const liveEvents = state.events[agentId] ?? []
      const merged = mergeHistoryWithLiveEvents(history, liveEvents)
      const wasEvicted = merged.length > MAX_EVENTS_PER_AGENT
      return {
        events: {
          ...state.events,
          [agentId]: wasEvicted ? merged.slice(-MAX_EVENTS_PER_AGENT) : merged
        },
        evictedAgents: wasEvicted
          ? { ...state.evictedAgents, [agentId]: true }
          : state.evictedAgents
      }
    })
  },

  clear(agentId: string) {
    set((state) => {
      const nextEvents = { ...state.events }
      const nextEvicted = { ...state.evictedAgents }
      delete nextEvents[agentId]
      delete nextEvicted[agentId]
      return { events: nextEvents, evictedAgents: nextEvicted }
    })
  }
}))
