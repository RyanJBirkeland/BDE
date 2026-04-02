import { create } from 'zustand'
import type { AgentEvent } from '../../../shared/types'

const MAX_EVENTS_PER_AGENT = 2000

interface AgentEventsState {
  events: Record<string, AgentEvent[]>
  evictedAgents: Record<string, boolean>
  init: () => () => void
  loadHistory: (agentId: string) => Promise<void>
  clear: (agentId: string) => void
}

export const useAgentEventsStore = create<AgentEventsState>((set) => ({
  events: {},
  evictedAgents: {},

  init() {
    return window.api.agentEvents.onEvent(({ agentId, event }) => {
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
  },

  async loadHistory(agentId: string) {
    const history = await window.api.agentEvents.getHistory(agentId)
    const wasEvicted = history.length > MAX_EVENTS_PER_AGENT
    set((state) => ({
      events: {
        ...state.events,
        [agentId]: wasEvicted ? history.slice(-MAX_EVENTS_PER_AGENT) : history
      },
      evictedAgents: wasEvicted
        ? { ...state.evictedAgents, [agentId]: true }
        : state.evictedAgents
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
