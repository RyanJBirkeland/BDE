import { create } from 'zustand'
import type { AgentMeta } from '../../../shared/types'
import { createLogPollerActions, type LogPollerState } from '../lib/logPoller'
import { AGENT_LIST_FETCH_LIMIT } from '../lib/constants'

/**
 * Agent runtime monitoring store for Agents view and log streaming.
 *
 * NOTE: This store queries agent_runs table similarly to costData store,
 * but serves a DIFFERENT purpose. This is intentional separation of concerns:
 * - agentHistory: runtime metadata (status, logPath, pid, bin, source) for agent list/logs
 * - costData: cost tracking fields (durationMs, numTurns, cache stats) for Dashboard
 *
 * Only 8 fields overlap (id, model, timestamps, tokens). Consolidating would
 * mix unrelated concerns and complicate the interface.
 */
interface AgentHistoryState extends LogPollerState {
  agents: AgentMeta[]
  selectedId: string | null
  fetched: boolean
  fetchError: string | null
  hasMore: boolean
  displayedCount: number

  fetchAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  clearSelection: () => void
  startLogPolling: (id: string) => () => void
  stopLogPolling: () => void
  importExternal: (meta: Partial<AgentMeta>, content: string) => Promise<void>
  loadMore: () => void
}

export type { AgentMeta }

const INITIAL_DISPLAY_COUNT = 30
const LOAD_MORE_INCREMENT = 20

export const useAgentHistoryStore = create<AgentHistoryState>((set, get) => {
  const poller = createLogPollerActions(get, set)

  return {
    agents: [],
    selectedId: null,
    fetched: false,
    logContent: '',
    logNextByte: 0,
    logTrimmedLines: 0,
    fetchError: null,
    hasMore: false,
    displayedCount: INITIAL_DISPLAY_COUNT,

    fetchAgents: async (): Promise<void> => {
      set({ fetchError: null })
      try {
        const agents = await window.api.agents.list({ limit: AGENT_LIST_FETCH_LIMIT })
        set({
          agents,
          fetched: true,
          hasMore: agents.length > INITIAL_DISPLAY_COUNT,
          displayedCount: INITIAL_DISPLAY_COUNT
        })
      } catch {
        set({ fetchError: 'Failed to load agent list' })
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
        poller.startLogPolling((fromByte) => window.api.agents.readLog({ id, fromByte }))
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
      return poller.startLogPolling((fromByte) => window.api.agents.readLog({ id, fromByte }))
    },

    stopLogPolling: poller.stopLogPolling,

    importExternal: async (meta, content): Promise<void> => {
      try {
        await window.api.agents.import({ meta, content })
        await get().fetchAgents()
      } catch {
        // Non-critical
      }
    },

    loadMore: (): void => {
      const { displayedCount, agents } = get()
      const newCount = Math.min(displayedCount + LOAD_MORE_INCREMENT, agents.length)
      set({
        displayedCount: newCount,
        hasMore: newCount < agents.length
      })
    }
  }
})
