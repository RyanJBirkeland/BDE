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
 * yet. We union the two and de-duplicate equivalent events so a replay
 * from SQLite doesn't produce duplicate cards. Chronology is preserved by
 * sorting on `timestamp`; `Array.prototype.sort` is stable since ES2019,
 * so events sharing a millisecond keep their emit order.
 *
 * The dedup key is built from each event's distinguishing primitive fields
 * rather than `JSON.stringify(event)` — `agent:tool_result` events can carry
 * 10KB+ of tool output, and stringifying them on every merge was causing
 * agent-console stutter when an agent streamed many tool calls per second.
 */
function mergeHistoryWithLiveEvents(history: AgentEvent[], live: AgentEvent[]): AgentEvent[] {
  const seen = new Map<string, AgentEvent>()
  for (const event of [...history, ...live]) {
    const key = dedupKey(event)
    if (!seen.has(key)) seen.set(key, event)
  }
  const merged = [...seen.values()]
  merged.sort((a, b) => a.timestamp - b.timestamp)
  return merged
}

function dedupKey(event: AgentEvent): string {
  switch (event.type) {
    case 'agent:text':
    case 'agent:user_message':
    case 'agent:stderr':
      return `${event.type}|${event.timestamp}|${event.text.length}|${event.text.slice(0, 64)}`
    case 'agent:thinking':
      return `${event.type}|${event.timestamp}|${event.tokenCount}|${event.text?.slice(0, 32) ?? ''}`
    case 'agent:tool_call':
      return `${event.type}|${event.timestamp}|${event.tool}|${event.summary}`
    case 'agent:tool_result':
      return `${event.type}|${event.timestamp}|${event.tool}|${event.success}|${event.summary}`
    case 'agent:error':
      return `${event.type}|${event.timestamp}|${event.message}`
    case 'agent:rate_limited':
      return `${event.type}|${event.timestamp}|${event.attempt}|${event.retryDelayMs}`
    case 'agent:started':
      return `${event.type}|${event.timestamp}|${event.model}`
    case 'agent:completed':
      return `${event.type}|${event.timestamp}|${event.exitCode}|${event.costUsd}`
    case 'agent:playground':
      return `${event.type}|${event.timestamp}|${event.filename}|${event.sizeBytes}`
  }
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
