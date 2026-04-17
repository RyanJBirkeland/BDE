import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { typedInvoke, onBroadcast } from './ipc-helpers'
import type { AgentMeta, SpawnLocalAgentArgs } from '../shared/types'
import type { IpcChannelMap } from '../shared/ipc-channels'
import type { BroadcastChannels } from '../shared/ipc-channels/broadcast-channels'

export const getAgentProcesses =
  (): Promise<IpcChannelMap['local:getAgentProcesses']['result']> =>
    typedInvoke('local:getAgentProcesses')

export const spawnLocalAgent = (
  args: SpawnLocalAgentArgs
): Promise<IpcChannelMap['local:spawnClaudeAgent']['result']> =>
  typedInvoke('local:spawnClaudeAgent', args)

export const steerAgent = (
  agentId: string,
  message: string,
  images?: Array<{ data: string; mimeType: string }>
): Promise<IpcChannelMap['agent:steer']['result']> =>
  typedInvoke('agent:steer', { agentId, message, images })

export const killAgent = (agentId: string): Promise<IpcChannelMap['agent:kill']['result']> =>
  typedInvoke('agent:kill', agentId)

export const getLatestCacheTokens = (
  runId: string
): Promise<IpcChannelMap['agent:latestCacheTokens']['result']> =>
  typedInvoke('agent:latestCacheTokens', runId)

export const tailAgentLog = (args: {
  logPath: string
  fromByte?: number
}): Promise<IpcChannelMap['local:tailAgentLog']['result']> =>
  typedInvoke('local:tailAgentLog', args)

export const agents = {
  list: (args: { limit?: number; status?: string }): Promise<IpcChannelMap['agents:list']['result']> =>
    typedInvoke('agents:list', args),
  readLog: (args: { id: string; fromByte?: number }): Promise<IpcChannelMap['agents:readLog']['result']> =>
    typedInvoke('agents:readLog', args),
  import: (args: {
    meta: Partial<AgentMeta>
    content: string
  }): Promise<IpcChannelMap['agents:import']['result']> => typedInvoke('agents:import', args),
  promoteToReview: (agentId: string): Promise<IpcChannelMap['agents:promoteToReview']['result']> =>
    typedInvoke('agents:promoteToReview', agentId)
}

export const agentManager = {
  status: (): Promise<IpcChannelMap['agent-manager:status']['result']> =>
    typedInvoke('agent-manager:status'),
  kill: (taskId: string): Promise<IpcChannelMap['agent-manager:kill']['result']> =>
    typedInvoke('agent-manager:kill', taskId),
  getMetrics: (): Promise<IpcChannelMap['agent-manager:metrics']['result']> =>
    typedInvoke('agent-manager:metrics'),
  reloadConfig: (): Promise<IpcChannelMap['agent-manager:reloadConfig']['result']> =>
    typedInvoke('agent-manager:reloadConfig'),
  checkpoint: (
    taskId: string,
    message?: string
  ): Promise<IpcChannelMap['agent-manager:checkpoint']['result']> =>
    typedInvoke('agent-manager:checkpoint', taskId, message),
  onWarning: onBroadcast<BroadcastChannels['manager:warning']>('manager:warning'),
  onCircuitBreakerOpen: onBroadcast<BroadcastChannels['agent-manager:circuit-breaker-open']>(
    'agent-manager:circuit-breaker-open'
  )
}

export const agentEvents = {
  onEvent: (callback: (payload: BroadcastChannels['agent:event']) => void): (() => void) => {
    const batchHandler = (
      _e: IpcRendererEvent,
      payloads: BroadcastChannels['agent:event:batch']
    ): void => {
      for (const p of payloads) {
        callback(p)
      }
    }
    ipcRenderer.on('agent:event:batch', batchHandler)
    return () => {
      ipcRenderer.removeListener('agent:event:batch', batchHandler)
    }
  },
  getHistory: (agentId: string): Promise<IpcChannelMap['agent:history']['result']> =>
    typedInvoke('agent:history', agentId)
}
