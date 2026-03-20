import { safeHandle } from '../ipc-utils'
import { validateRepoPath } from '../validation'
import {
  getAgentProcesses,
  spawnClaudeAgent,
  tailAgentLog,
  cleanupOldLogs,
  sendToAgent,
  isAgentInteractive,
  steerAgent,
  killAgent
} from '../local-agents'
import type { SpawnLocalAgentArgs, TailLogArgs } from '../local-agents'
import {
  listAgents,
  readLog,
  importAgent,
  pruneOldAgents
} from '../agent-history'
import type { AgentMeta } from '../agent-history'
import {
  getAgentBinary,
  getAgentPermissionMode,
  setSetting,
  SETTING_AGENT_BINARY,
  SETTING_AGENT_PERMISSION_MODE
} from '../settings'

export function registerAgentHandlers(): void {
  // --- Local agent process detection + spawning ---
  safeHandle('local:getAgentProcesses', () => getAgentProcesses())
  safeHandle('local:spawnClaudeAgent', (_e, args: SpawnLocalAgentArgs) => {
    validateRepoPath(args.repoPath)
    return spawnClaudeAgent(args)
  })
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  safeHandle('local:sendToAgent', (_e, { pid, message }: { pid: number; message: string }) =>
    sendToAgent(pid, message)
  )
  safeHandle('local:isInteractive', (_e, pid: number) =>
    isAgentInteractive(pid)
  )
  safeHandle('agent:steer', (_e, { agentId, message }: { agentId: string; message: string }) =>
    steerAgent(agentId, message)
  )
  safeHandle('agent:kill', (_e, agentId: string) =>
    killAgent(agentId)
  )
  cleanupOldLogs()

  // --- Agent config IPC ---
  safeHandle('config:getAgentConfig', () => ({
    binary: getAgentBinary(),
    permissionMode: getAgentPermissionMode()
  }))
  safeHandle('config:saveAgentConfig', (_e, config: { binary: string; permissionMode: string }) => {
    if (config.binary) setSetting(SETTING_AGENT_BINARY, config.binary.trim())
    if (config.permissionMode) setSetting(SETTING_AGENT_PERMISSION_MODE, config.permissionMode.trim())
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
