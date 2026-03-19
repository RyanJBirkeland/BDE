import { resolve } from 'path'
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
import { getRepoPaths } from '../git'
import {
  getAgentBinary,
  getAgentPermissionMode,
  setSetting,
  SETTING_AGENT_BINARY,
  SETTING_AGENT_PERMISSION_MODE
} from '../settings'

/** Validates that repoPath is under a known configured repository root. */
function validateRepoPath(repoPath: string): void {
  const resolved = resolve(repoPath)
  const repoPaths = Object.values(getRepoPaths()).map(p => resolve(p))
  const allowed = repoPaths.some(
    root => resolved.startsWith(root + '/') || resolved === root
  )
  if (!allowed) {
    throw new Error(`Repository path rejected: "${repoPath}" is not a configured repository`)
  }
}

export function registerAgentHandlers(): void {
  // --- Local agent process detection + spawning ---
  safeHandle('local:getAgentProcesses', () => getAgentProcesses())
  safeHandle('local:spawnClaudeAgent', (_e, args: SpawnLocalAgentArgs) => {
    validateRepoPath(args.repoPath)
    return spawnClaudeAgent(args)
  })
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
  safeHandle('agent:kill', async (_e, agentId: string) => {
    const { killAgent } = await import('../local-agents')
    return killAgent(agentId)
  })
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
