import { create } from 'zustand'
import type { AgentEvent } from '../../../shared/types'

const MAX_EVENTS_PER_AGENT = 2000
const EMPTY_EVENTS: AgentEvent[] = []

let unsubscribe: (() => void) | null = null

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
    unsubscribe = window.api.agents.events.onEvent(({ agentId, event }) => {
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
    const history = await window.api.agents.events.getHistory(agentId)
    const wasEvicted = history.length > MAX_EVENTS_PER_AGENT
    set((state) => ({
      events: {
        ...state.events,
        [agentId]: wasEvicted ? history.slice(-MAX_EVENTS_PER_AGENT) : history
      },
      evictedAgents: wasEvicted ? { ...state.evictedAgents, [agentId]: true } : state.evictedAgents
    }))
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
