import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createLogPollerActions, type LogPollerState } from '../lib/logPoller'
import { getProcesses, spawnLocal, tailLog } from '../services/agents'

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
  /**
   * The runtime model is resolved in the main process from
   * `agents.backendConfig` via `resolveAgentRuntime`. Callers do not — and
   * cannot — influence which model the agent runs on from here; change the
   * routing in Settings → Models instead.
   */
  spawnAgent: (args: {
    task: string
    repoPath: string
    assistant?: boolean | undefined
  }) => Promise<{ pid: number; logPath: string; id: string }>
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
            const procs = await getProcesses()
            set({ processes: procs })
          } catch (err) {
            console.error('Failed to fetch agent processes:', err)
          }
        },

        setCollapsed: (collapsed): void => {
          set({ collapsed })
        },

        spawnAgent: async (args) => {
          set({ isSpawning: true })
          try {
            const result = await spawnLocal({
              task: args.task,
              repoPath: args.repoPath,
              assistant: args.assistant
            })
            set((s) => ({
              spawnedAgents: [
                ...s.spawnedAgents,
                {
                  id: result.id,
                  pid: result.pid,
                  logPath: result.logPath,
                  task: args.task,
                  repoPath: args.repoPath,
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
          return poller.startLogPolling((fromByte) => tailLog({ logPath, fromByte }))
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
