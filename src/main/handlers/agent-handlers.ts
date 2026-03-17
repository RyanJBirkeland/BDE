import { safeHandle } from '../ipc-utils'
import {
  getAgentProcesses,
  spawnClaudeAgent,
  tailAgentLog,
  cleanupOldLogs
} from '../local-agents'
import type { SpawnLocalAgentArgs, TailLogArgs } from '../local-agents'
import {
  listAgents,
  readLog,
  importAgent,
  pruneOldAgents
} from '../agent-history'
import type { AgentMeta } from '../agent-history'

export function registerAgentHandlers(): void {
  // --- Local agent process detection + spawning ---
  // TODO: AX-S1 — add 'local:getAgentProcesses' to IpcChannelMap
  safeHandle('local:getAgentProcesses', () => getAgentProcesses())
  safeHandle('local:spawnClaudeAgent', (_e, args: SpawnLocalAgentArgs) =>
    spawnClaudeAgent(args)
  )
  // TODO: AX-S1 — add 'local:tailAgentLog', 'local:sendToAgent', 'local:isInteractive' to IpcChannelMap
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  safeHandle('local:sendToAgent', async (_e, { pid, message }: { pid: number; message: string }) => {
    const { sendToAgent } = await import('../local-agents')
    return sendToAgent(pid, message)
  })
  safeHandle('local:isInteractive', async (_e, pid: number) => {
    const { isAgentInteractive } = await import('../local-agents')
    return isAgentInteractive(pid)
  })
  safeHandle('agent:steer', async (_e, { agentId, message }: { agentId: string; message: string }) => {
    const { steerAgent } = await import('../local-agents')
    return await steerAgent(agentId, message)
  })
  cleanupOldLogs()

  // --- Agent history IPC ---
  // TODO: AX-S1 — add 'agents:list', 'agents:readLog', 'agents:import' to IpcChannelMap
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
