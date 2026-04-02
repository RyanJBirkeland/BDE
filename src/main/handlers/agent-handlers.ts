/**
 * Agent IPC handlers — proxies agent lifecycle operations through the
 * task-runner's Runner API and provides local history/log access from SQLite.
 */
import { safeHandle } from '../ipc-utils'
import { steerAgent, killAgent, listAgents as listRunnerAgents } from '../runner-client'
import { tailAgentLog, cleanupOldLogs } from '../agent-log-manager'
import type { TailLogArgs } from '../agent-log-manager'
import { listAgents, readLog, importAgent, pruneOldAgents } from '../agent-history'
import type { AgentMeta } from '../agent-history'
import { spawnAdhocAgent, getAdhocHandle } from '../adhoc-agent'
import type { SpawnLocalAgentArgs } from '../../shared/types'
import type { AgentManager } from '../agent-manager'

export function registerAgentHandlers(am?: AgentManager): void {
  // --- Runner-proxied agent operations ---
  safeHandle('local:getAgentProcesses', async () => {
    // Process scanning removed — return runner agents instead
    try {
      const agents = await listRunnerAgents()
      return Array.isArray(agents) ? agents : []
    } catch {
      return []
    }
  })
  safeHandle('local:spawnClaudeAgent', async (_e, args: SpawnLocalAgentArgs) => {
    return spawnAdhocAgent({
      task: args.task,
      repoPath: args.repoPath,
      model: args.model,
      assistant: args.assistant
    })
  })
  safeHandle('agent:spawnAssistant', async (_e, args: { repoPath: string; model?: string }) => {
    return spawnAdhocAgent({
      task: 'You are now ready to assist. Wait for the user\'s first message.',
      repoPath: args.repoPath,
      model: args.model,
      assistant: true
    })
  })
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  safeHandle(
    'agent:steer',
    async (_e, { agentId, message }: { agentId: string; message: string }) => {
      // Try ad-hoc agents first
      const adhocHandle = getAdhocHandle(agentId)
      if (adhocHandle) {
        try {
          await adhocHandle.send(message)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: String(err) }
        }
      }
      // Try local AgentManager
      if (am) {
        const result = await am.steerAgent(agentId, message)
        if (result.delivered) return { ok: true }
        return { ok: false, error: result.error }
      }
      // Fall back to runner-client only when no local AgentManager
      return steerAgent(agentId, message)
    }
  )
  safeHandle('agent:kill', async (_e, agentId: string) => {
    // Try ad-hoc agents first
    const adhocHandle = getAdhocHandle(agentId)
    if (adhocHandle) {
      adhocHandle.close()
      return { ok: true }
    }
    if (am) {
      try {
        am.killAgent(agentId)
        return { ok: true }
      } catch {
        /* fall through */
      }
    }
    return killAgent(agentId)
  })
  safeHandle('agent:history', async (_e, agentId: string) => {
    // Event history from local SQLite — kept for viewing historical runs
    const { getEventHistory } = await import('../data/event-queries')
    const { getDb } = await import('../db')
    const rows = getEventHistory(getDb(), agentId)
    return rows.map((r) => JSON.parse(r.payload))
  })
  cleanupOldLogs()

  // --- Agent history IPC ---
  safeHandle('agents:list', (_e, args: { limit?: number; status?: string }) =>
    listAgents(args.limit, args.status)
  )
  safeHandle('agents:readLog', (_e, args: { id: string; fromByte?: number }) =>
    readLog(args.id, args.fromByte)
  )
  safeHandle('agents:import', (_e, args: { meta: Partial<AgentMeta>; content: string }) =>
    importAgent(args.meta, args.content)
  )
  pruneOldAgents()
}
