import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { POLL_LOG_INTERVAL } from '../lib/constants'

export interface LocalAgentProcess {
  pid: number
  bin: string
  args: string
  cwd: string | null
  startedAt: number
  cpuPct: number
  memMb: number
}

export interface SpawnedAgent {
  id: string
  pid: number
  logPath: string
  task: string
  repoPath: string
  model: string
  spawnedAt: number
  interactive: boolean
}

interface LocalAgentsState {
  processes: LocalAgentProcess[]
  lastUpdated: number
  collapsed: boolean
  // Spawned agent tracking
  spawnedAgents: SpawnedAgent[]
  isSpawning: boolean
  // Log viewer state
  selectedLocalAgentPid: number | null
  logContent: string
  logNextByte: number
  _logInterval: ReturnType<typeof setInterval> | null

  fetchProcesses: () => Promise<void>
  setCollapsed: (collapsed: boolean) => void
  spawnAgent: (args: {
    task: string
    repoPath: string
    model?: string
  }) => Promise<{ pid: number; logPath: string; id: string }>
  sendToAgent: (pid: number, message: string) => Promise<void>
  killLocalAgent: (pid: number) => Promise<void>
  selectLocalAgent: (pid: number | null) => void
  startLogPolling: (logPath: string) => void
  stopLogPolling: () => void
}

export const useLocalAgentsStore = create<LocalAgentsState>()(
  persist(
    (set, get) => ({
  processes: [],
  lastUpdated: 0,
  collapsed: false,
  spawnedAgents: [],
  isSpawning: false,
  selectedLocalAgentPid: null,
  logContent: '',
  logNextByte: 0,
  _logInterval: null,

  fetchProcesses: async (): Promise<void> => {
    try {
      const procs = await window.api.getAgentProcesses()
      set({ processes: procs, lastUpdated: Date.now() })
    } catch (err) {
      console.warn('[localAgents] fetchProcesses failed:', err)
    }
  },

  setCollapsed: (collapsed): void => {
    set({ collapsed })
  },

  spawnAgent: async (args) => {
    set({ isSpawning: true })
    try {
      const result = await window.api.spawnLocalAgent(args)
      set((s) => ({
        spawnedAgents: [
          ...s.spawnedAgents,
          {
            id: result.id,
            pid: result.pid,
            logPath: result.logPath,
            task: args.task,
            repoPath: args.repoPath,
            model: args.model ?? 'sonnet',
            spawnedAt: Date.now(),
            interactive: result.interactive ?? false
          }
        ]
      }))
      return result
    } finally {
      set({ isSpawning: false })
    }
  },

  sendToAgent: async (pid, message) => {
    const result = await window.api.sendToAgent(pid, message)
    if (!result.ok) {
      throw new Error(result.error ?? 'Cannot send to agent — stdin not available (agent may have been spawned outside this session)')
    }
  },

  killLocalAgent: async (pid): Promise<void> => {
    await window.api.killLocalAgent(pid)
    // Let ps-polling clean up the process list naturally
  },

  selectLocalAgent: (pid): void => {
    const prev = get()
    if (prev._logInterval) {
      clearInterval(prev._logInterval)
    }
    set({
      selectedLocalAgentPid: pid,
      logContent: '',
      logNextByte: 0,
      _logInterval: null
    })
  },

  startLogPolling: (logPath): void => {
    const prev = get()
    if (prev._logInterval) clearInterval(prev._logInterval)

    const poll = async (): Promise<void> => {
      try {
        const result = await window.api.tailAgentLog({
          logPath,
          fromByte: get().logNextByte
        })
        if (result.content) {
          set((s) => ({
            logContent: s.logContent + result.content,
            logNextByte: result.nextByte
          }))
        }
      } catch {
        // Log file may not exist yet
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
  }
  }),
  {
    name: 'bde-local-agents',
    // Only persist spawnedAgents — not ephemeral runtime state
    partialize: (s) => ({ spawnedAgents: s.spawnedAgents })
  }
)
)
