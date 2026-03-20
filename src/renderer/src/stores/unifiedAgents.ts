/**
 * Unified agents store — composes sessions, localAgents, and agentHistory
 * stores into a single normalized list of UnifiedAgent objects.
 *
 * Delegates to existing stores for data fetching and actions.
 * This store owns: unified agent list, selection state, and fetchAll.
 */
import { create } from 'zustand'
import type { UnifiedAgent, UnifiedAgentSource, UnifiedAgentStatus } from '../../../shared/types'
import { useSessionsStore } from './sessions'
import { useLocalAgentsStore } from './localAgents'
import { useAgentHistoryStore } from './agentHistory'
import { toast } from './toasts'

export type { UnifiedAgent, UnifiedAgentSource, UnifiedAgentStatus }

const FIVE_MINUTES = 5 * 60 * 1000

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

function normalizeStatus(raw: string | undefined): UnifiedAgentStatus {
  switch (raw) {
    case 'running':
      return 'running'
    case 'done':
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'timeout':
      return 'timeout'
    default:
      return 'unknown'
  }
}

function normalizeSource(raw: string): UnifiedAgentSource {
  switch (raw) {
    case 'bde':
      return 'local'
    case 'openclaw':
      return 'gateway'
    default:
      return 'history'
  }
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) : s
}

function safeTimestamp(value: string | number | null | undefined): number {
  if (value == null) return 0
  if (typeof value === 'number') return value
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

interface UnifiedAgentsStore {
  agents: UnifiedAgent[]
  selectedId: string | null
  loading: boolean

  fetchAll: () => Promise<void>
  select: (id: string | null) => void
  spawn: (args: { task: string; repoPath: string; model?: string; planning?: boolean }) => Promise<void>
  steer: (id: string, message: string) => Promise<void>
  kill: (agent: UnifiedAgent) => Promise<void>
}

/** Build the unified agent list from underlying store state. */
function buildAgentList(): UnifiedAgent[] {
  const sessions = useSessionsStore.getState().sessions
  const subAgents = useSessionsStore.getState().subAgents
  const processes = useLocalAgentsStore.getState().processes
  const historyAgents = useAgentHistoryStore.getState().agents

  const now = Date.now()
  const agents: UnifiedAgent[] = []

  // Gateway sessions (openclaw)
  for (const s of sessions) {
    const isRunning = (s.updatedAt ?? 0) > now - FIVE_MINUTES
    agents.push({
      id: s.key,
      label: s.displayName || s.key,
      source: 'gateway',
      status: isRunning ? 'running' : 'done',
      model: s.model ?? '',
      updatedAt: s.updatedAt ?? 0,
      startedAt: s.updatedAt ?? 0,
      canSteer: true,
      canKill: isRunning,
      isBlocked: s.abortedLastRun === true && !isRunning,
      sessionKey: s.key
    })
  }

  // Sub-agents (gateway)
  for (const a of subAgents) {
    agents.push({
      id: `sub:${a.sessionKey}`,
      label: a.label || a.sessionKey,
      source: 'gateway',
      status: normalizeStatus(a.status),
      model: a.model ?? '',
      updatedAt: a.endedAt ?? a.startedAt ?? 0,
      startedAt: a.startedAt ?? 0,
      canSteer: !!a.isActive,
      canKill: !!a.isActive,
      isBlocked: false,
      task: truncate(a.task, 80),
      sessionKey: a.sessionKey
    })
  }

  // Local running processes
  for (const p of processes) {
    const label = p.cwd ? p.cwd.split('/').pop() ?? p.bin : p.bin
    agents.push({
      id: `local:${p.pid}`,
      label,
      source: 'local',
      status: 'running',
      model: '',
      updatedAt: p.startedAt ?? 0,
      startedAt: p.startedAt ?? 0,
      canSteer: false,
      canKill: true,
      isBlocked: false,
      pid: p.pid
    })
  }

  // History agents (all statuses)
  const localPids = new Set(processes.map((p) => p.pid))
  for (const a of historyAgents) {
    const started = safeTimestamp(a.startedAt)
    const finished = safeTimestamp(a.finishedAt)
    const isRunning = a.status === 'running'
    // Skip if already represented by a live ps-aux process row
    if (isRunning && a.pid && localPids.has(a.pid)) continue
    agents.push({
      id: `history:${a.id}`,
      label: a.repo || a.bin || a.id,
      source: normalizeSource(a.source),
      status: normalizeStatus(a.status),
      model: a.model ?? '',
      updatedAt: finished || started,
      startedAt: started,
      canSteer: false,
      canKill: isRunning && !!a.pid,
      isBlocked: false,
      task: truncate(a.task, 80),
      historyId: a.id,
      pid: a.pid ?? undefined
    })
  }

  return agents
}

export const useUnifiedAgentsStore = create<UnifiedAgentsStore>((set, get) => ({
  agents: [],
  selectedId: null,
  loading: false,

  fetchAll: async (): Promise<void> => {
    set({ loading: true })

    // Delegate to underlying stores in parallel
    await Promise.allSettled([
      useSessionsStore.getState().fetchSessions(),
      useLocalAgentsStore.getState().fetchProcesses(),
      useAgentHistoryStore.getState().fetchAgents()
    ])

    set({ agents: buildAgentList(), loading: false })
  },

  select: (id): void => {
    set({ selectedId: id })

    // Sync selection to underlying stores
    const agentHistory = useAgentHistoryStore.getState()
    const localAgents = useLocalAgentsStore.getState()
    const sessions = useSessionsStore.getState()

    // Clear all first
    agentHistory.selectAgent(null)
    localAgents.selectLocalAgent(null)

    if (!id) return

    if (id.startsWith('local:')) {
      const pid = parseInt(id.substring(6), 10)
      localAgents.selectLocalAgent(pid)
    } else if (id.startsWith('history:')) {
      const historyId = id.substring(8)
      agentHistory.selectAgent(historyId)
    } else {
      sessions.selectSession(id)
    }
  },

  spawn: async (args): Promise<void> => {
    try {
      const task = args.planning
        ? `${PLANNING_PROMPT_PREFIX}\n\nUser request: ${args.task}`
        : args.task
      await useLocalAgentsStore.getState().spawnAgent({ ...args, task })
      toast.success('Agent spawned')
      await get().fetchAll()
    } catch (err) {
      toast.error(`Spawn failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  },

  steer: async (id, message): Promise<void> => {
    // Find the agent to determine how to steer
    const agent = get().agents.find((a) => a.id === id)
    if (!agent) return

    if (agent.source === 'local' && agent.pid) {
      try {
        await useLocalAgentsStore.getState().sendToAgent(agent.pid, message)
        toast.success('Message sent')
      } catch (err) {
        toast.error(`Failed to send: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else if (agent.sessionKey) {
      await useSessionsStore.getState().steerSubAgent(agent.sessionKey, message)
    }
  },

  kill: async (agent): Promise<void> => {
    if (agent.source === 'local' && agent.pid) {
      await useLocalAgentsStore.getState().killLocalAgent(agent.pid)
      toast.success('Agent killed')
    } else if (agent.sessionKey) {
      await useSessionsStore.getState().killSession(agent.sessionKey)
    }
  }
}))
