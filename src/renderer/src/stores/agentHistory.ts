import { create } from 'zustand'
import type { AgentMeta } from '../../../shared/types'
import { createLogPollerActions, type LogPollerState } from '../lib/logPoller'
import { AGENT_LIST_FETCH_LIMIT } from '../lib/constants'

interface AgentHistoryState extends LogPollerState {
  agents: AgentMeta[]
  selectedId: string | null
  loading: boolean

  fetchAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  clearSelection: () => void
  startLogPolling: (id: string) => () => void
  stopLogPolling: () => void
  importExternal: (meta: Partial<AgentMeta>, content: string) => Promise<void>
}

export type { AgentMeta }

export const useAgentHistoryStore = create<AgentHistoryState>((set, get) => {
  const poller = createLogPollerActions(get, set)

  return {
    agents: [],
    selectedId: null,
    logContent: '',
    logNextByte: 0,
    logTrimmedLines: 0,
    loading: false,

    fetchAgents: async (): Promise<void> => {
      set({ loading: true })
      try {
        const agents = await window.api.agents.list({ limit: AGENT_LIST_FETCH_LIMIT })
        set({ agents })
      } catch {
        // Non-critical
      } finally {
        set({ loading: false })
      }
    },

    selectAgent: (id): void => {
      poller.stopLogPolling()
      set({
        selectedId: id,
        logContent: '',
        logNextByte: 0,
        logTrimmedLines: 0
      })
      if (id) {
        poller.startLogPolling((fromByte) =>
          window.api.agents.readLog({ id, fromByte })
        )
      }
    },

    clearSelection: (): void => {
      poller.stopLogPolling()
      set({
        selectedId: null,
        logContent: '',
        logNextByte: 0,
        logTrimmedLines: 0
      })
    },

    startLogPolling: (id): (() => void) => {
      return poller.startLogPolling((fromByte) =>
        window.api.agents.readLog({ id, fromByte })
      )
    },

    stopLogPolling: poller.stopLogPolling,

    importExternal: async (meta, content): Promise<void> => {
      try {
        await window.api.agents.import({ meta, content })
        await get().fetchAgents()
      } catch {
        // Non-critical
      }
    }
  }
})
