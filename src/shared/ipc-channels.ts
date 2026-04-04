/**
 * Typed IPC channel map — single source of truth for channel names and payloads.
 *
 * Each entry maps a channel name to its `args` tuple and `result` type.
 * Both `safeHandle()` (main) and `typedInvoke()` (preload) derive their
 * types from this map, giving end-to-end compile-time safety.
 *
 * Channels are organised into domain-specific interfaces that are composed
 * into the final `IpcChannelMap` intersection type.  Consumers can import
 * the narrow domain type when they only need a subset.
 */

import type {
  SpawnLocalAgentArgs,
  SpawnLocalAgentResult,
  AgentMeta,
  AgentCostRecord,
  AgentRunCostRow,
  CostSummary,
  SprintTask,
  ClaimedTask,
  PrListPayload,
  TaskTemplate,
  AgentManagerStatus,
  SynthesizeRequest,
  ReviseRequest
} from './types'
import type { AgentEvent } from './types'
import type { BatchOperation, BatchResult } from './types'

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

// ---------------------------------------------------------------------------
// Domain-specific channel maps
// ---------------------------------------------------------------------------

/** Settings CRUD */
export interface SettingsChannels {
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
}

/** Git operations */
export interface GitChannels {
  'git:status': {
    args: [cwd: string]
    result: { files: { path: string; status: string; staged: boolean }[]; branch: string }
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
}

/** Pull request operations */
export interface PrChannels {
  'pr:pollStatuses': {
    args: [prs: { taskId: string; prUrl: string }[]]
    result: {
      taskId: string
      merged: boolean
      state: string
      mergedAt: string | null
      mergeableState: string | null
    }[]
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
}

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
}

/** GitHub API proxy */
export interface GitHubApiChannels {
  'github:fetch': {
    args: [path: string, init?: GitHubFetchInit]
    result: GitHubFetchResult
  }
}

/** Cost tracking */
export interface CostChannels {
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
}

/** Sprint task management */
export interface SprintChannels {
  'sprint:list': {
    args: []
    result: SprintTask[]
  }
  'sprint:create': {
    args: [
      task: {
        title: string
        repo: string
        prompt?: string
        notes?: string
        spec?: string
        priority?: number
        status?: string
        template_name?: string
        playground_enabled?: boolean
      }
    ]
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
  'sprint:validateDependencies': {
    args: [taskId: string, deps: Array<{ id: string; type: 'hard' | 'soft' }>]
    result: { valid: boolean; error?: string; cycle?: string[] }
  }
  'sprint:unblockTask': {
    args: [taskId: string]
    result: SprintTask | null
  }
  'sprint:getChanges': {
    args: [taskId: string]
    result: Array<{
      id: number
      task_id: string
      field: string
      old_value: string | null
      new_value: string | null
      changed_by: string
      changed_at: string
    }>
  }
  'sprint:batchUpdate': {
    args: [operations: BatchOperation[]]
    result: { results: BatchResult[] }
  }
  'sprint:retry': {
    args: [taskId: string]
    result: SprintTask
  }
}

/** Window shell integration */
export interface WindowChannels {
  'window:openExternal': {
    args: [url: string]
    result: void
  }
  'playground:openInBrowser': {
    args: [html: string]
    result: string
  }
}

/** Tear-off window management */
export interface TearoffChannels {
  'tearoff:create': {
    args: [
      {
        view: string
        screenX: number
        screenY: number
        sourcePanelId: string
        sourceTabIndex: number
      }
    ]
    result: { windowId: string }
  }
  'tearoff:closeConfirmed': {
    args: [{ action: 'return' | 'close'; remember: boolean }]
    result: void
  }
  'tearoff:startCrossWindowDrag': {
    args: [{ windowId: string; viewKey: string }]
    result: { targetFound: boolean }
  }
}

/** Memory file operations */
export interface MemoryChannels {
  'memory:listFiles': {
    args: []
    result: { path: string; name: string; size: number; modifiedAt: number; active: boolean }[]
  }
  'memory:readFile': {
    args: [path: string]
    result: string
  }
  'memory:writeFile': {
    args: [path: string, content: string]
    result: void
  }
  'memory:search': {
    args: [query: string]
    result: Array<{
      path: string
      matches: Array<{ line: number; content: string }>
    }>
  }
  'memory:getActiveFiles': {
    args: []
    result: Record<string, boolean>
  }
  'memory:setFileActive': {
    args: [path: string, active: boolean]
    result: Record<string, boolean>
  }
}

/** File system dialogs and reading */
export interface FsChannels {
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
  'fs:readDir': {
    args: [dirPath: string]
    result: { name: string; type: 'file' | 'directory'; size: number }[]
  }
  'fs:readFile': { args: [filePath: string]; result: string }
  'fs:writeFile': { args: [filePath: string, content: string]; result: void }
  'fs:watchDir': { args: [dirPath: string]; result: { success: boolean; error?: string } }
  'fs:unwatchDir': { args: []; result: void }
  'fs:createFile': { args: [filePath: string]; result: void }
  'fs:createDir': { args: [dirPath: string]; result: void }
  'fs:rename': { args: [oldPath: string, newPath: string]; result: void }
  'fs:delete': { args: [targetPath: string]; result: void }
  'fs:stat': {
    args: [targetPath: string]
    result: { size: number; mtime: number; isDirectory: boolean }
  }
}

/** Agent event streaming */
export interface AgentEventChannels {
  'agent:event': {
    args: [payload: { agentId: string; event: AgentEvent }]
    result: void
  }
  'agent:history': {
    args: [agentId: string]
    result: AgentEvent[]
  }
}

/** Task template CRUD */
export interface TemplateChannels {
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
}

/** Auth status */
export interface AuthChannels {
  'auth:status': {
    args: []
    result: { cliFound: boolean; tokenFound: boolean; tokenExpired: boolean; expiresAt?: string }
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
}

/** Terminal PTY management */
export interface TerminalChannels {
  'terminal:create': {
    args: [opts: { cols: number; rows: number; shell?: string; cwd?: string }]
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

/** Task Workbench AI-assisted creation */
export interface WorkbenchChannels {
  'workbench:chat': {
    args: [
      input: {
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
        formContext: { title: string; repo: string; spec: string }
      }
    ]
    result: { content: string }
  }
  'workbench:generateSpec': {
    args: [input: { title: string; repo: string; templateHint: string }]
    result: { spec: string }
  }
  'workbench:checkSpec': {
    args: [input: { title: string; repo: string; spec: string; specType?: string | null }]
    result: {
      clarity: { status: 'pass' | 'warn' | 'fail'; message: string }
      scope: { status: 'pass' | 'warn' | 'fail'; message: string }
      filesExist: { status: 'pass' | 'warn' | 'fail'; message: string; missingFiles?: string[] }
    }
  }
  'workbench:checkOperational': {
    args: [input: { repo: string }]
    result: {
      auth: { status: 'pass' | 'warn' | 'fail'; message: string }
      repoPath: { status: 'pass' | 'fail'; message: string; path?: string }
      gitClean: { status: 'pass' | 'warn'; message: string }
      noConflict: { status: 'pass' | 'warn' | 'fail'; message: string }
      slotsAvailable: { status: 'pass' | 'warn'; message: string; available: number; max: number }
    }
  }
  'workbench:researchRepo': {
    args: [input: { query: string; repo: string }]
    result: {
      content: string
      filesSearched: string[]
      totalMatches: number
    }
  }
  'workbench:chatStream': {
    args: [
      input: {
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
        formContext: { title: string; repo: string; spec: string }
      }
    ]
    result: { streamId: string }
  }
  'workbench:cancelStream': {
    args: [streamId: string]
    result: { ok: boolean }
  }
}

/** Dev Playground operations */
export interface PlaygroundChannels {
  'playground:show': {
    args: [input: { filePath: string }]
    result: void
  }
}

/** Claude CLI config (~/.claude/settings.json) */
export interface ClaudeConfigChannels {
  'claude:getConfig': {
    args: []
    result: { permissions?: { allow?: string[]; deny?: string[] }; [key: string]: unknown }
  }
  'claude:setPermissions': {
    args: [{ allow: string[]; deny: string[] }]
    result: void
  }
}

/** Dashboard analytics */
export interface CompletionBucket {
  hour: string
  count: number
}

export interface DashboardEvent {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
}

export interface DashboardChannels {
  'agent:completionsPerHour': { args: []; result: CompletionBucket[] }
  'agent:recentEvents': { args: [limit?: number]; result: DashboardEvent[] }
}

/** Code review operations */
export interface ReviewChannels {
  'review:getDiff': {
    args: [payload: { worktreePath: string; base: string }]
    result: {
      files: Array<{
        path: string
        status: string
        additions: number
        deletions: number
        patch: string
      }>
    }
  }
  'review:getCommits': {
    args: [payload: { worktreePath: string; base: string }]
    result: {
      commits: Array<{ hash: string; message: string; author: string; date: string }>
    }
  }
  'review:getFileDiff': {
    args: [payload: { worktreePath: string; filePath: string; base: string }]
    result: { diff: string }
  }
  'review:mergeLocally': {
    args: [payload: { taskId: string; strategy: 'squash' | 'merge' | 'rebase' }]
    result: { success: boolean; conflicts?: string[]; error?: string }
  }
  'review:createPr': {
    args: [payload: { taskId: string; title: string; body: string }]
    result: { prUrl: string }
  }
  'review:requestRevision': {
    args: [payload: { taskId: string; feedback: string; mode: 'resume' | 'fresh' }]
    result: { success: boolean }
  }
  'review:discard': {
    args: [payload: { taskId: string }]
    result: { success: boolean }
  }
}

/** Spec synthesizer AI-powered generation */
export interface SynthesizerChannels {
  'synthesizer:generate': {
    args: [request: SynthesizeRequest]
    result: { streamId: string }
  }
  'synthesizer:revise': {
    args: [request: ReviseRequest]
    result: { streamId: string }
  }
  'synthesizer:cancel': {
    args: [streamId: string]
    result: { ok: boolean }
  }
}

// ---------------------------------------------------------------------------
// Composite channel map — intersection of all domain maps
// ---------------------------------------------------------------------------

export type IpcChannelMap = SettingsChannels &
  GitChannels &
  PrChannels &
  AgentChannels &
  GitHubApiChannels &
  CostChannels &
  SprintChannels &
  WindowChannels &
  MemoryChannels &
  FsChannels &
  AgentEventChannels &
  TemplateChannels &
  AuthChannels &
  AgentManagerChannels &
  TerminalChannels &
  WorkbenchChannels &
  PlaygroundChannels &
  DashboardChannels &
  SynthesizerChannels &
  ReviewChannels &
  TearoffChannels &
  ClaudeConfigChannels
