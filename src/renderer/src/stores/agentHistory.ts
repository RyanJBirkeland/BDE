import { create } from 'zustand'
import type { AgentMeta } from '../../../preload/index.d'
import { POLL_LOG_INTERVAL, AGENT_LIST_FETCH_LIMIT } from '../lib/constants'

interface AgentHistoryState {
  agents: AgentMeta[]
  selectedId: string | null
  logContent: string
  logNextByte: number
  loading: boolean
  isFetching: boolean
  _logInterval: ReturnType<typeof setInterval> | null

  fetchAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  clearSelection: () => void
  startLogPolling: (id: string) => void
  stopLogPolling: () => void
  importExternal: (meta: Partial<AgentMeta>, content: string) => Promise<void>
}

export type { AgentMeta }

export const useAgentHistoryStore = create<AgentHistoryState>((set, get) => ({
  agents: [],
  selectedId: null,
  logContent: '',
  logNextByte: 0,
  loading: false,
  isFetching: false,
  _logInterval: null,

  fetchAgents: async (): Promise<void> => {
    set({ isFetching: true })
    try {
      const agents = await window.api.agents.list({ limit: AGENT_LIST_FETCH_LIMIT })
      set({ agents })
    } catch {
      // Non-critical
    } finally {
      set({ isFetching: false })
    }
  },

  selectAgent: (id): void => {
    const prev = get()
    if (prev._logInterval) clearInterval(prev._logInterval)
    set({
      selectedId: id,
      logContent: '',
      logNextByte: 0,
      _logInterval: null
    })
    if (id) {
      get().startLogPolling(id)
    }
  },

  clearSelection: (): void => {
    const prev = get()
    if (prev._logInterval) clearInterval(prev._logInterval)
    set({
      selectedId: null,
      logContent: '',
      logNextByte: 0,
      _logInterval: null
    })
  },

  startLogPolling: (id): void => {
    const prev = get()
    if (prev._logInterval) clearInterval(prev._logInterval)

    const poll = async (): Promise<void> => {
      try {
        const result = await window.api.agents.readLog({
          id,
          fromByte: get().logNextByte
        })
        if (result.content) {
          set((s) => ({
            logContent: s.logContent + result.content,
            logNextByte: result.nextByte
          }))
        }
      } catch {
        // Log may not exist yet
      }
    }

    poll()
    const interval = setInterval(poll, POLL_LOG_INTERVAL)
    set({ _logInterval: interval })
  },

  stopLogPolling: (): void => {
    const { _logInterval } = get()
    if (_logInterval) {
      clearInterval(_logInterval)
      set({ _logInterval: null })
    }
  },

  importExternal: async (meta, content): Promise<void> => {
    try {
      await window.api.agents.import({ meta, content })
      await get().fetchAgents()
    } catch {
      // Non-critical
    }
  }
}))
