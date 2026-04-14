import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { typedInvoke } from './ipc-helpers'
import type { AgentMeta, SpawnLocalAgentArgs } from '../shared/types'
import type { BroadcastChannels } from '../shared/ipc-channels/broadcast-channels'

export const getAgentProcesses = () => typedInvoke('local:getAgentProcesses')

export const spawnLocalAgent = (args: SpawnLocalAgentArgs) =>
  typedInvoke('local:spawnClaudeAgent', args)

export const steerAgent = (
  agentId: string,
  message: string,
  images?: Array<{ data: string; mimeType: string }>
) => typedInvoke('agent:steer', { agentId, message, images })

export const killAgent = (agentId: string) => typedInvoke('agent:kill', agentId)

export const getLatestCacheTokens = (runId: string) =>
  typedInvoke('agent:latestCacheTokens', runId)

export const tailAgentLog = (args: { logPath: string; fromByte?: number }) =>
  typedInvoke('local:tailAgentLog', args)

export const agents = {
  list: (args: { limit?: number; status?: string }) => typedInvoke('agents:list', args),
  readLog: (args: { id: string; fromByte?: number }) => typedInvoke('agents:readLog', args),
  import: (args: { meta: Partial<AgentMeta>; content: string }) =>
    typedInvoke('agents:import', args),
  promoteToReview: (agentId: string) => typedInvoke('agents:promoteToReview', agentId)
}

export const agentManager = {
  status: () => typedInvoke('agent-manager:status'),
  kill: (taskId: string) => typedInvoke('agent-manager:kill', taskId),
  getMetrics: () => typedInvoke('agent-manager:metrics'),
  reloadConfig: () => typedInvoke('agent-manager:reloadConfig'),
  checkpoint: (taskId: string, message?: string) =>
    typedInvoke('agent-manager:checkpoint', taskId, message)
}

export const agentEvents = {
  onEvent: (callback: (payload: BroadcastChannels['agent:event']) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: BroadcastChannels['agent:event']): void =>
      callback(payload)
    const batchHandler = (
      _e: IpcRendererEvent,
      payloads: BroadcastChannels['agent:event:batch']
    ): void => {
      for (const p of payloads) {
        callback(p)
      }
    }
    ipcRenderer.on('agent:event', handler)
    ipcRenderer.on('agent:event:batch', batchHandler)
    return () => {
      ipcRenderer.removeListener('agent:event', handler)
      ipcRenderer.removeListener('agent:event:batch', batchHandler)
    }
  },
  getHistory: (agentId: string) => typedInvoke('agent:history', agentId)
}
