import { create } from 'zustand'

export interface LocalAgentProcess {
  pid: number
  bin: string
  args: string
  cwd: string | null
  startedAt: number
  cpuPct: number
  memMb: number
}

interface LocalAgentsState {
  processes: LocalAgentProcess[]
  lastUpdated: number
  collapsed: boolean
  fetchProcesses: () => Promise<void>
  setCollapsed: (collapsed: boolean) => void
}

export const useLocalAgentsStore = create<LocalAgentsState>((set) => ({
  processes: [],
  lastUpdated: 0,
  collapsed: false,

  fetchProcesses: async (): Promise<void> => {
    try {
      const procs = await window.api.getAgentProcesses()
      set({ processes: procs, lastUpdated: Date.now() })
    } catch {
      // Silently fail — local agents are non-critical
    }
  },

  setCollapsed: (collapsed): void => {
    set({ collapsed })
  }
}))
