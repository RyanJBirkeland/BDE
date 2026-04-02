import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createLogPollerActions, type LogPollerState } from '../lib/logPoller'

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

interface LocalAgentsState extends LogPollerState {
  processes: LocalAgentProcess[]
  collapsed: boolean
  spawnedAgents: SpawnedAgent[]
  isSpawning: boolean
  selectedLocalAgentPid: number | null

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
  startLogPolling: (logPath: string) => () => void
  stopLogPolling: () => void
}

export const useLocalAgentsStore = create<LocalAgentsState>()(
  persist(
    (set, get) => {
      const poller = createLogPollerActions(get, set)

      return {
        processes: [],
        collapsed: false,
        spawnedAgents: [],
        isSpawning: false,
        selectedLocalAgentPid: null,
        logContent: '',
        logNextByte: 0,
        logTrimmedLines: 0,

        fetchProcesses: async (): Promise<void> => {
          try {
            const procs = await window.api.getAgentProcesses()
            set({ processes: procs })
          } catch {
            // Silently fail — local agents are non-critical
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

        sendToAgent: async (_pid, _message) => {
          throw new Error(
            'Direct PID-based messaging removed. Use agent:steer with an agent ID instead.'
          )
        },

        killLocalAgent: async (_pid): Promise<void> => {
          throw new Error(
            'Local PID-based agent kill removed. Use agent:kill with an agent ID instead.'
          )
        },

        selectLocalAgent: (pid): void => {
          poller.stopLogPolling()
          set({
            selectedLocalAgentPid: pid,
            logContent: '',
            logNextByte: 0,
            logTrimmedLines: 0
          })
        },

        startLogPolling: (logPath): (() => void) => {
          return poller.startLogPolling((fromByte) =>
            window.api.tailAgentLog({ logPath, fromByte })
          )
        },

        stopLogPolling: poller.stopLogPolling
      }
    },
    {
      name: 'bde-local-agents',
      partialize: (s) => ({ spawnedAgents: s.spawnedAgents })
    }
  )
)
