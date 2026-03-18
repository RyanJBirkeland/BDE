import { create } from 'zustand'
import type { AgentCostRecord } from '../../../shared/types'

interface CostDataState {
  localAgents: AgentCostRecord[]
  isFetching: boolean
  totalCost: number
  fetchLocalAgents: () => Promise<void>
}

export const useCostDataStore = create<CostDataState>((set, get) => ({
  localAgents: [],
  isFetching: false,
  totalCost: 0,

  fetchLocalAgents: async (): Promise<void> => {
    if (get().isFetching) return
    set({ isFetching: true })
    try {
      const agents = await window.api.cost.getAgentHistory()
      const total = agents.reduce((sum, a) => sum + (a.costUsd ?? 0), 0)
      set({ localAgents: agents, totalCost: total })
    } catch (err) {
      console.error('[costData] fetchLocalAgents failed:', err)
    } finally {
      set({ isFetching: false })
    }
  }
}))
