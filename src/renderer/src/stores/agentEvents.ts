import { create } from 'zustand'
import type { AgentEvent } from '../../../shared/types'

interface AgentEventsState {
  events: Record<string, AgentEvent[]>
  init: () => () => void
  loadHistory: (agentId: string) => Promise<void>
  clear: (agentId: string) => void
}

export const useAgentEventsStore = create<AgentEventsState>((set) => ({
  events: {},

  init() {
    return window.api.agentEvents.onEvent(({ agentId, event }) => {
      set((state) => ({
        events: {
          ...state.events,
          [agentId]: [...(state.events[agentId] ?? []), event]
        }
      }))
    })
  },

  async loadHistory(agentId: string) {
    const history = await window.api.agentEvents.getHistory(agentId)
    set((state) => ({
      events: { ...state.events, [agentId]: history }
    }))
  },

  clear(agentId: string) {
    set((state) => {
      const next = { ...state.events }
      delete next[agentId]
      return { events: next }
    })
  }
}))
