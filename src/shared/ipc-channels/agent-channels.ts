/**
 * Agent lifecycle, events, and manager IPC channels.
 */

import type {
  SpawnLocalAgentArgs,
  SpawnLocalAgentResult,
  AgentMeta,
  AgentEvent,
  AgentManagerStatus,
  MetricsSnapshot,
  AgentRunSummary
} from '../types'

/** Agent lifecycle and interaction */
export interface AgentChannels {
  'local:spawnClaudeAgent': {
    args: [args: SpawnLocalAgentArgs]
    result: SpawnLocalAgentResult
  }
  'local:getAgentProcesses': {
    args: []
    result: {
      pid: number
      bin: string
      args: string
      cwd: string | null
      startedAt: number
      cpuPct: number
      memMb: number
    }[]
  }
  'local:tailAgentLog': {
    args: [args: { logPath: string; fromByte?: number | undefined }]
    result: { content: string; nextByte: number }
  }
  'agent:steer': {
    args: [
      args: { agentId: string; message: string; images?: Array<{ data: string; mimeType: string }> }
    ]
    result: { ok: boolean; error?: string | undefined }
  }
  'agent:kill': {
    args: [agentId: string]
    result: { ok: boolean; error?: string | undefined }
  }
  'agents:list': {
    args: [args: { limit?: number | undefined; status?: string | undefined }]
    result: AgentMeta[]
  }
  'agents:readLog': {
    args: [args: { id: string; fromByte?: number | undefined }]
    result: { content: string; nextByte: number }
  }
  'agents:import': {
    args: [args: { meta: Partial<AgentMeta>; content: string }]
    result: AgentMeta
  }
  'agents:promoteToReview': {
    args: [agentId: string]
    result: { ok: boolean; taskId?: string | undefined; error?: string | undefined }
  }
  'agents:testLocalEndpoint': {
    args: [args: { endpoint: string }]
    result: { ok: true; latencyMs: number; modelCount: number } | { ok: false; error: string }
  }
  'agent:latestCacheTokens': {
    args: [runId: string]
    result: {
      cacheTokensRead: number
      cacheTokensCreated: number
      tokensIn: number
      tokensOut: number
    } | null
  }
}

export interface AgentEventChannels {
  'agent:history': {
    args: [agentId: string]
    result: AgentEvent[]
  }
}

/** Agent manager orchestration */
export interface AgentManagerChannels {
  'agent-manager:status': {
    args: []
    result: AgentManagerStatus
  }
  'agent-manager:kill': {
    args: [taskId: string]
    result: { ok: boolean }
  }
  'agent-manager:metrics': {
    args: []
    result: MetricsSnapshot | null
  }
  'agent-manager:reloadConfig': {
    args: []
    result: { updated: string[]; requiresRestart: string[] }
  }
  'agent-manager:checkpoint': {
    args: [taskId: string, message?: string]
    result: { ok: boolean; committed: boolean; error?: string | undefined }
  }
}

/** Cost tracking */
export interface CostChannels {
  'cost:summary': {
    args: []
    result: import('../types').CostSummary
  }
  'cost:agentRuns': {
    args: [args: { limit?: number | undefined }]
    result: AgentRunSummary[]
  }
  'cost:getAgentHistory': {
    args: [args?: { limit?: number | undefined; offset?: number | undefined }]
    result: import('../types').AgentCostRecord[]
  }
}
