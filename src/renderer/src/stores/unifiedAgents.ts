/**
 * Unified agents store — composes localAgents and agentHistory
 * stores into a single normalized list of UnifiedAgent objects.
 *
 * Delegates to existing stores for data fetching and actions.
 * This store owns: unified agent list, selection state, and fetchAll.
 */
import { create } from 'zustand'
import type { UnifiedAgent, UnifiedAgentSource, UnifiedAgentStatus } from '../../../shared/types'
import { useLocalAgentsStore } from './localAgents'
import { useAgentHistoryStore } from './agentHistory'
import { toast } from './toasts'
import { buildUnifiedAgentList } from '../lib/agentNormalizers'

export type { UnifiedAgent, UnifiedAgentSource, UnifiedAgentStatus }

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

interface UnifiedAgentsStore {
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
}

/** Build the unified agent list from underlying store state. */
function buildAgentList(): UnifiedAgent[] {
  const processes = useLocalAgentsStore.getState().processes
  const historyAgents = useAgentHistoryStore.getState().agents
  return buildUnifiedAgentList(processes, historyAgents)
}

export const useUnifiedAgentsStore = create<UnifiedAgentsStore>((set, get) => ({
  agents: [],
  selectedId: null,
  loading: false,

  fetchAll: async (): Promise<void> => {
    set({ loading: true })

    // Delegate to underlying stores in parallel
    await Promise.allSettled([
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

    if (agent.source === 'local') {
      try {
        await useLocalAgentsStore.getState().sendToAgent(agent.pid, message)
        toast.success('Message sent')
      } catch (err) {
        toast.error(`Failed to send: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  },

  kill: async (agent): Promise<void> => {
    if (agent.source === 'local') {
      await useLocalAgentsStore.getState().killLocalAgent(agent.pid)
      toast.success('Agent killed')
    }
  }
}))
