/**
 * Typed IPC channel map — single source of truth for channel names and payloads.
 *
 * Each entry maps a channel name to its `args` tuple and `result` type.
 * Both `safeHandle()` (main) and `typedInvoke()` (preload) derive their
 * types from this map, giving end-to-end compile-time safety.
 */

import type { SpawnLocalAgentArgs, SpawnLocalAgentResult, AgentMeta, AgentCostRecord, AgentRunCostRow, CostSummary, SprintTask, ClaimedTask, PrListPayload, TaskTemplate } from './types'
import type { TaskOutputEvent } from './queue-api-contract'
import type { AgentEvent } from '../main/agents/types'

/** Serialisable subset of RequestInit for the github:fetch IPC proxy. */
export interface GitHubFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** Shape returned by the github:fetch IPC handler. */
export interface GitHubFetchResult {
  ok: boolean
  status: number
  body: unknown
  /** Parsed "next" URL from the GitHub Link header (for pagination). */
  linkNext: string | null
}

export interface IpcChannelMap {
  // --- Config ---
  'config:getGatewayUrl': {
    args: []
    result: { url: string; hasToken: boolean }
  }
  'config:saveGateway': {
    args: [url: string, token?: string]
    result: void
  }

  // --- Settings CRUD ---
  'settings:get': {
    args: [key: string]
    result: string | null
  }
  'settings:set': {
    args: [key: string, value: string]
    result: void
  }
  'settings:getJson': {
    args: [key: string]
    result: unknown
  }
  'settings:setJson': {
    args: [key: string, value: unknown]
    result: void
  }
  'settings:delete': {
    args: [key: string]
    result: void
  }

  // --- Gateway auth (tokens stay in main process) ---
  'gateway:test-connection': {
    args: [url: string, token?: string]
    result: { ok: boolean; latencyMs: number }
  }
  'gateway:sign-challenge': {
    args: []
    result: { auth: { token: string } }
  }

  // --- Git ---
  'git:status': {
    args: [cwd: string]
    result: { files: { path: string; status: string; staged: boolean }[] }
  }
  'git:diff': {
    args: [cwd: string, file?: string]
    result: string
  }
  'git:getRepoPaths': {
    args: []
    result: Record<string, string>
  }
  'git:stage': {
    args: [cwd: string, files: string[]]
    result: void
  }
  'git:unstage': {
    args: [cwd: string, files: string[]]
    result: void
  }
  'git:commit': {
    args: [cwd: string, message: string]
    result: void
  }
  'git:push': {
    args: [cwd: string]
    result: string
  }
  'git:branches': {
    args: [cwd: string]
    result: { current: string; branches: string[] }
  }
  'git:checkout': {
    args: [cwd: string, branch: string]
    result: void
  }

  // --- PR ---
  'pr:pollStatuses': {
    args: [prs: { taskId: string; prUrl: string }[]]
    result: { taskId: string; merged: boolean; state: string; mergedAt: string | null; mergeableState: string | null }[]
  }
  'pr:checkConflictFiles': {
    args: [input: { owner: string; repo: string; prNumber: number }]
    result: { prNumber: number; files: string[]; baseBranch: string; headBranch: string }
  }
  'pr:getList': {
    args: []
    result: PrListPayload
  }
  'pr:refreshList': {
    args: []
    result: PrListPayload
  }

  // --- Agent config ---
  'config:getAgentConfig': {
    args: []
    result: { binary: string; permissionMode: string }
  }
  'config:saveAgentConfig': {
    args: [config: { binary: string; permissionMode: string }]
    result: void
  }

  // --- Agents ---
  'local:spawnClaudeAgent': {
    args: [args: SpawnLocalAgentArgs]
    result: SpawnLocalAgentResult
  }
  'local:getAgentProcesses': {
    args: []
    result: { pid: number; bin: string; args: string; cwd: string | null; startedAt: number; cpuPct: number; memMb: number }[]
  }
  'local:sendToAgent': {
    args: [args: { pid: number; message: string }]
    result: { ok: boolean; error?: string }
  }
  'local:isInteractive': {
    args: [pid: number]
    result: boolean
  }
  'local:tailAgentLog': {
    args: [args: { logPath: string; fromByte?: number }]
    result: { content: string; nextByte: number }
  }
  'agent:steer': {
    args: [args: { agentId: string; message: string }]
    result: { ok: boolean; error?: string }
  }
  'agent:kill': {
    args: [agentId: string]
    result: { ok: boolean; error?: string }
  }
  'agent:killLocal': {
    args: [pid: number]
    result: { ok: boolean; error?: string }
  }
  'agents:list': {
    args: [args: { limit?: number; status?: string }]
    result: AgentMeta[]
  }
  'agents:readLog': {
    args: [args: { id: string; fromByte?: number }]
    result: { content: string; nextByte: number }
  }
  'agents:import': {
    args: [args: { meta: Partial<AgentMeta>; content: string }]
    result: AgentMeta
  }

  // --- GitHub API proxy ---
  'github:fetch': {
    args: [path: string, init?: GitHubFetchInit]
    result: GitHubFetchResult
  }

  // --- Cost ---
  'cost:summary': {
    args: []
    result: CostSummary
  }
  'cost:agentRuns': {
    args: [args: { limit?: number }]
    result: AgentRunCostRow[]
  }
  'cost:getAgentHistory': {
    args: [args?: { limit?: number; offset?: number }]
    result: AgentCostRecord[]
  }

  // --- Queue ---
  'queue:health': {
    args: []
    result: { queue: Record<string, number>; doneToday: number; connectedRunners: number }
  }

  // --- Task Events (streaming visibility) ---
  'task:getEvents': {
    args: [taskId: string]
    result: TaskOutputEvent[]
  }

  // --- Sprint ---
  'sprint:list': {
    args: []
    result: SprintTask[]
  }
  'sprint:create': {
    args: [task: { title: string; repo: string; prompt?: string; notes?: string; spec?: string; priority?: number; status?: string; template_name?: string }]
    result: SprintTask
  }
  'sprint:update': {
    args: [id: string, patch: Record<string, unknown>]
    result: SprintTask | null
  }
  'sprint:delete': {
    args: [id: string]
    result: { ok: boolean }
  }
  'sprint:readSpecFile': {
    args: [filePath: string]
    result: string
  }
  'sprint:generatePrompt': {
    args: [args: { taskId: string; title: string; repo: string; templateHint: string }]
    result: { taskId: string; spec: string; prompt: string }
  }
  'sprint:healthCheck': {
    args: []
    result: SprintTask[]
  }
  'sprint:claimTask': {
    args: [taskId: string]
    result: ClaimedTask | null
  }
  'sprint:readLog': {
    args: [agentId: string, fromByte?: number]
    result: { content: string; status: string; nextByte: number }
  }

  // --- Window ---
  'window:openExternal': {
    args: [url: string]
    result: void
  }

  // --- Memory ---
  'memory:listFiles': {
    args: []
    result: { path: string; name: string; size: number; modifiedAt: number }[]
  }
  'memory:readFile': {
    args: [path: string]
    result: string
  }
  'memory:writeFile': {
    args: [path: string, content: string]
    result: void
  }

  // --- File system ---
  'fs:openFileDialog': {
    args: [opts?: { filters?: { name: string; extensions: string[] }[] }]
    result: string[] | null
  }
  'fs:readFileAsBase64': {
    args: [path: string]
    result: { data: string; mimeType: string; name: string }
  }
  'fs:readFileAsText': {
    args: [path: string]
    result: { content: string; name: string }
  }
  'fs:openDirectoryDialog': {
    args: []
    result: string | null
  }

  // --- Gateway RPC ---
  'gateway:invoke': {
    args: [tool: string, args: Record<string, unknown>]
    result: unknown
  }
  'gateway:getSessionHistory': {
    args: [sessionKey: string]
    result: unknown
  }

  // --- Agent Event Streaming (Phase 2) ---
  'agent:event': {
    args: [payload: { agentId: string; event: AgentEvent }]
    result: void
  }
  'agent:history': {
    args: [agentId: string]
    result: AgentEvent[]
  }

  // --- Template CRUD (Phase 2) ---
  'templates:list': {
    args: []
    result: TaskTemplate[]
  }
  'templates:save': {
    args: [template: TaskTemplate]
    result: void
  }
  'templates:delete': {
    args: [name: string]
    result: void
  }
  'templates:reset': {
    args: [name: string]
    result: void
  }

  // --- Terminal ---
  'terminal:create': {
    args: [opts: { cols: number; rows: number; shell?: string }]
    result: number
  }
  'terminal:resize': {
    args: [args: { id: number; cols: number; rows: number }]
    result: void
  }
  'terminal:kill': {
    args: [id: number]
    result: void
  }
}
