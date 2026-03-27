/**
 * Unified agents store — consolidates agentEvents, agentHistory,
 * localAgents, and unifiedAgents into a single Zustand store.
 *
 * Sections:
 *   - Local processes (spawn, kill, send)
 *   - History (fetch, import)
 *   - Unified view (merged agent list, selection, spawn/steer/kill facades)
 *   - Events (real-time event stream, history loading, cap enforcement)
 *   - Log polling (two independent pollers: local + history)
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AgentMeta,
  AgentEvent,
  UnifiedAgent,
  UnifiedAgentSource,
  UnifiedAgentStatus
} from '../../../shared/types'
import { createLogPollerActions, type LogPollerState } from '../lib/logPoller'
import { AGENT_LIST_FETCH_LIMIT } from '../lib/constants'
import { buildUnifiedAgentList } from '../lib/agentNormalizers'
import { toast } from './toasts'

export type { AgentMeta, UnifiedAgent, UnifiedAgentSource, UnifiedAgentStatus }

export const PLANNING_PROMPT_PREFIX = `You are a coding partner helping plan and spec features for this project.

Your role: investigate the codebase, ask clarifying questions, write detailed specs, and decompose features into well-defined tickets.

When you have a complete plan, output the tickets as a \`\`\`tickets-json code block:
[
  {
    "title": "Short descriptive title",
    "prompt": "Detailed prompt the coding agent will receive",
    "repo": "repo-name",
    "priority": 1,
    "template": "feature|bugfix|refactor|test"
  }
]

Rules for tickets:
- Each ticket should be independently implementable
- Prompts must reference exact file paths and functions
- Order by dependency (earlier tickets first, lower priority number = higher urgency)
- Include test tickets where appropriate`

const MAX_EVENTS_PER_AGENT = 2000

// ── Exported types ──────────────────────────────────────────────

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

// ── Store interface ─────────────────────────────────────────────

interface AgentsState {
  // — Local processes —
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

  // — Local log polling —
  localLog: LogPollerState
  startLocalLogPolling: (logPath: string) => () => void
  stopLocalLogPolling: () => void

  // — History —
  historyAgents: AgentMeta[]
  historySelectedId: string | null
  historyLoading: boolean

  fetchAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  clearSelection: () => void
  importExternal: (meta: Partial<AgentMeta>, content: string) => Promise<void>

  // — History log polling —
  historyLog: LogPollerState
  startHistoryLogPolling: (id: string) => () => void
  stopHistoryLogPolling: () => void

  // — Unified view —
  agents: UnifiedAgent[]
  selectedId: string | null
  loading: boolean

  fetchAll: () => Promise<void>
  select: (id: string | null) => void
  spawn: (args: {
    task: string
    repoPath: string
    model?: string
    planning?: boolean
  }) => Promise<void>
  steer: (id: string, message: string) => Promise<void>
  kill: (agent: UnifiedAgent) => Promise<void>

  // — Events —
  events: Record<string, AgentEvent[]>
  initEvents: () => () => void
  loadEventHistory: (agentId: string) => Promise<void>
  clearEvents: (agentId: string) => void
}

// ── Store implementation ────────────────────────────────────────

export const useAgentsStore = create<AgentsState>()(
  persist(
    (set, get) => {
      // Two independent log pollers
      const localPoller = createLogPollerActions(
        () => get().localLog,
        (patch) => set({ localLog: { ...get().localLog, ...patch } })
      )
      const historyPoller = createLogPollerActions(
        () => get().historyLog,
        (patch) => set({ historyLog: { ...get().historyLog, ...patch } })
      )

      function buildAgentList(): UnifiedAgent[] {
        const { processes, historyAgents } = get()
        return buildUnifiedAgentList(processes, historyAgents)
      }

      return {
        // ── Local processes ──────────────────────────────────
        processes: [],
        collapsed: false,
        spawnedAgents: [],
        isSpawning: false,
        selectedLocalAgentPid: null,

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

        sendToAgent: async (pid, message) => {
          const result = await window.api.sendToAgent(pid, message)
          if (!result.ok) {
            throw new Error(
              result.error ??
                'Cannot send to agent — stdin not available (agent may have been spawned outside this session)'
            )
          }
        },

        killLocalAgent: async (pid): Promise<void> => {
          await window.api.killLocalAgent(pid)
        },

        selectLocalAgent: (pid): void => {
          localPoller.stopLogPolling()
          set({
            selectedLocalAgentPid: pid,
            localLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 }
          })
        },

        // ── Local log polling ────────────────────────────────
        localLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 },

        startLocalLogPolling: (logPath): (() => void) => {
          return localPoller.startLogPolling((fromByte) =>
            window.api.tailAgentLog({ logPath, fromByte })
          )
        },

        stopLocalLogPolling: localPoller.stopLogPolling,

        // ── History ──────────────────────────────────────────
        historyAgents: [],
        historySelectedId: null,
        historyLoading: false,

        fetchAgents: async (): Promise<void> => {
          set({ historyLoading: true })
          try {
            const agents = await window.api.agents.list({ limit: AGENT_LIST_FETCH_LIMIT })
            set({ historyAgents: agents })
          } catch {
            // Non-critical
          } finally {
            set({ historyLoading: false })
          }
        },

        selectAgent: (id): void => {
          historyPoller.stopLogPolling()
          set({
            historySelectedId: id,
            historyLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 }
          })
          if (id) {
            historyPoller.startLogPolling((fromByte) =>
              window.api.agents.readLog({ id, fromByte })
            )
          }
        },

        clearSelection: (): void => {
          historyPoller.stopLogPolling()
          set({
            historySelectedId: null,
            historyLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 }
          })
        },

        importExternal: async (meta, content): Promise<void> => {
          try {
            await window.api.agents.import({ meta, content })
            await get().fetchAgents()
          } catch {
            // Non-critical
          }
        },

        // ── History log polling ──────────────────────────────
        historyLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 },

        startHistoryLogPolling: (id): (() => void) => {
          return historyPoller.startLogPolling((fromByte) =>
            window.api.agents.readLog({ id, fromByte })
          )
        },

        stopHistoryLogPolling: historyPoller.stopLogPolling,

        // ── Unified view ─────────────────────────────────────
        agents: [],
        selectedId: null,
        loading: false,

        fetchAll: async (): Promise<void> => {
          set({ loading: true })

          // Fetch both sources in parallel
          await Promise.allSettled([get().fetchProcesses(), get().fetchAgents()])

          set({ agents: buildAgentList(), loading: false })
        },

        select: (id): void => {
          set({ selectedId: id })

          // Clear all sub-selections first
          get().selectAgent(null)
          get().selectLocalAgent(null)

          if (!id) return

          if (id.startsWith('local:')) {
            const pid = parseInt(id.substring(6), 10)
            get().selectLocalAgent(pid)
          } else if (id.startsWith('history:')) {
            const historyId = id.substring(8)
            get().selectAgent(historyId)
          }
        },

        spawn: async (args): Promise<void> => {
          try {
            const task = args.planning
              ? `${PLANNING_PROMPT_PREFIX}\n\nUser request: ${args.task}`
              : args.task
            await get().spawnAgent({ ...args, task })
            toast.success('Agent spawned')
            await get().fetchAll()
          } catch (err) {
            toast.error(`Spawn failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        },

        steer: async (id, message): Promise<void> => {
          const agent = get().agents.find((a) => a.id === id)
          if (!agent) return

          if (agent.source === 'local') {
            try {
              await get().sendToAgent(agent.pid, message)
              toast.success('Message sent')
            } catch (err) {
              toast.error(`Failed to send: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
        },

        kill: async (agent): Promise<void> => {
          if (agent.source === 'local') {
            await get().killLocalAgent(agent.pid)
            toast.success('Agent killed')
          }
        },

        // ── Events ───────────────────────────────────────────
        events: {},

        initEvents() {
          return window.api.agentEvents.onEvent(({ agentId, event }) => {
            set((state) => {
              const existing = state.events[agentId] ?? []
              const updated = [...existing, event]
              return {
                events: {
                  ...state.events,
                  [agentId]:
                    updated.length > MAX_EVENTS_PER_AGENT
                      ? updated.slice(-MAX_EVENTS_PER_AGENT)
                      : updated
                }
              }
            })
          })
        },

        async loadEventHistory(agentId: string) {
          const history = await window.api.agentEvents.getHistory(agentId)
          set((state) => ({
            events: {
              ...state.events,
              [agentId]:
                history.length > MAX_EVENTS_PER_AGENT
                  ? history.slice(-MAX_EVENTS_PER_AGENT)
                  : history
            }
          }))
        },

        clearEvents(agentId: string) {
          set((state) => {
            const next = { ...state.events }
            delete next[agentId]
            return { events: next }
          })
        }
      }
    },
    {
      name: 'bde-local-agents',
      partialize: (s) => ({ spawnedAgents: s.spawnedAgents })
    }
  )
)
