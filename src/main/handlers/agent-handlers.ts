/**
 * Agent IPC handlers — proxies agent lifecycle operations through the
 * task-runner's Runner API and provides local history/log access from SQLite.
 */
import { safeHandle } from '../ipc-utils'
import {
  steerAgent,
  killAgent,
  listAgents as listRunnerAgents,
} from '../runner-client'
import { tailAgentLog, cleanupOldLogs } from '../agent-log-manager'
import type { TailLogArgs } from '../agent-log-manager'
import {
  listAgents,
  readLog,
  importAgent,
  pruneOldAgents
} from '../agent-history'
import type { AgentMeta } from '../agent-history'

export function registerAgentHandlers(): void {
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
  safeHandle('local:spawnClaudeAgent', async () => {
    // Agent spawning removed from BDE — dispatch tasks through the queue API instead
    throw new Error('Agent spawning is no longer supported in BDE. Use the task queue to dispatch work to the task-runner.')
  })
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  safeHandle('local:sendToAgent', async (_e, { pid: _pid, message: _message }: { pid: number; message: string }) => {
    return { ok: false, error: 'Direct PID-based messaging removed. Use agent:steer with an agent ID instead.' } as const
  })
  safeHandle('local:isInteractive', () => false)
  safeHandle('agent:steer', async (_e, { agentId, message }: { agentId: string; message: string }) =>
    steerAgent(agentId, message)
  )
  safeHandle('agent:kill', async (_e, agentId: string) =>
    killAgent(agentId)
  )
  safeHandle('agent:history', async (_e, agentId: string) => {
    // Event history from local SQLite — kept for viewing historical runs
    const { getEventHistory } = await import('../data/event-queries')
    const { getDb } = await import('../db')
    const rows = getEventHistory(getDb(), agentId)
    return rows.map((r) => JSON.parse(r.payload))
  })
  cleanupOldLogs()

  // --- Agent config IPC ---
  // Agent binary and permission mode are now managed by the task-runner, not BDE.
  // Return null to indicate these are no longer configurable from BDE.
  safeHandle('config:getAgentConfig', () => ({
    binary: null,
    permissionMode: null,
  }))
  safeHandle('config:saveAgentConfig', () => {
    // No-op: agent config now lives in task-runner's own configuration.
  })

  // --- Agent history IPC ---
  safeHandle('agents:list', (_e, args: { limit?: number; status?: string }) =>
    listAgents(args.limit, args.status)
  )
  safeHandle('agents:readLog', (_e, args: { id: string; fromByte?: number }) =>
    readLog(args.id, args.fromByte)
  )
  safeHandle(
    'agents:import',
    (_e, args: { meta: Partial<AgentMeta>; content: string }) =>
      importAgent(args.meta, args.content)
  )
  pruneOldAgents()
}
