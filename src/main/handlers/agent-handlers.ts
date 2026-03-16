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
  getAgentMeta,
  readLog,
  importAgent,
  updateAgentMeta,
  pruneOldAgents
} from '../agent-history'
import type { AgentMeta } from '../agent-history'

export function registerAgentHandlers(): void {
  // --- Local agent process detection + spawning ---
  safeHandle('local:getAgentProcesses', () => getAgentProcesses())
  safeHandle('local:spawnClaudeAgent', (_e, args: SpawnLocalAgentArgs) =>
    spawnClaudeAgent(args)
  )
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  safeHandle('local:sendToAgent', async (_e, { pid, message }: { pid: number; message: string }) => {
    const { sendToAgent } = await import('../local-agents')
    return sendToAgent(pid, message)
  })
  safeHandle('local:isInteractive', async (_e, pid: number) => {
    const { isAgentInteractive } = await import('../local-agents')
    return isAgentInteractive(pid)
  })
  cleanupOldLogs()

  // --- Agent history IPC ---
  safeHandle('agents:list', (_e, args: { limit?: number; status?: string }) =>
    listAgents(args.limit, args.status)
  )
  safeHandle('agents:getMeta', (_e, args: { id: string }) =>
    getAgentMeta(args.id)
  )
  safeHandle('agents:readLog', (_e, args: { id: string; fromByte?: number }) =>
    readLog(args.id, args.fromByte)
  )
  safeHandle(
    'agents:import',
    (_e, args: { meta: Partial<AgentMeta>; content: string }) =>
      importAgent(args.meta, args.content)
  )
  safeHandle('agents:markDone', async (_e, args: { id: string; exitCode: number }) => {
    await updateAgentMeta(args.id, {
      finishedAt: new Date().toISOString(),
      exitCode: args.exitCode,
      status: args.exitCode === 0 ? 'done' : 'failed'
    })
  })
  pruneOldAgents()

  // --- Session history (agent output tabs) ---
  safeHandle('sessions:getHistory', async (_event, _sessionKey: string) => {
    return []
  })
}
