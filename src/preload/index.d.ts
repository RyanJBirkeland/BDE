import { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentCostRecord, AgentMeta, AgentRunCostRow, CostSummary, PrListPayload, SpawnLocalAgentArgs, SpawnLocalAgentResult, SprintTask } from '../shared/types'
import type { IpcChannelMap, GitHubFetchInit, GitHubFetchResult } from '../shared/ipc-channels'

export type { AgentCostRecord, AgentMeta, SpawnLocalAgentArgs, SpawnLocalAgentResult, SprintTask }

/** Helper — extracts the result type for a typed IPC channel. */
type IpcResult<K extends keyof IpcChannelMap> = IpcChannelMap[K]['result']

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getGatewayConfig: () => Promise<IpcResult<'get-gateway-config'>>
      getGitHubToken: () => Promise<string | null>
      saveGatewayConfig: (...args: IpcChannelMap['save-gateway-config']['args']) => Promise<IpcResult<'save-gateway-config'>>
      getSupabaseConfig: () => Promise<{ url: string; anonKey: string } | null>
      getRepoPaths: () => Promise<Record<string, string>>
      openExternal: (url: string) => Promise<void>
      listMemoryFiles: () => Promise<
        { path: string; name: string; size: number; modifiedAt: number }[]
      >
      readMemoryFile: (path: string) => Promise<string>
      writeMemoryFile: (path: string, content: string) => Promise<void>
      setTitle: (title: string) => void

      // GitHub API proxy — all GitHub REST calls routed through main process
      github: {
        fetch: (path: string, init?: GitHubFetchInit) => Promise<GitHubFetchResult>
      }

      // Local agent process detection + spawning
      getAgentProcesses: () => Promise<
        {
          pid: number
          bin: string
          args: string
          cwd: string | null
          startedAt: number
          cpuPct: number
          memMb: number
        }[]
      >
      spawnLocalAgent: (...args: IpcChannelMap['local:spawnClaudeAgent']['args']) => Promise<IpcResult<'local:spawnClaudeAgent'>>
      sendToAgent: (pid: number, message: string) => Promise<{ ok: boolean; error?: string }>
      isAgentInteractive: (pid: number) => Promise<boolean>
      steerAgent: (agentId: string, message: string) => Promise<{ ok: boolean; error?: string }>
      killLocalAgent: (pid: number) => Promise<{ ok: boolean; error?: string }>
      killAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>
      tailAgentLog: (args: {
        logPath: string
        fromByte?: number
      }) => Promise<{ content: string; nextByte: number }>

      // Git client
      gitStatus: (...args: IpcChannelMap['git:status']['args']) => Promise<IpcResult<'git:status'>>
      gitDiff: (...args: IpcChannelMap['git:diff']['args']) => Promise<IpcResult<'git:diff'>>
      gitStage: (cwd: string, files: string[]) => Promise<void>
      gitUnstage: (cwd: string, files: string[]) => Promise<void>
      gitCommit: (cwd: string, message: string) => Promise<void>
      gitPush: (cwd: string) => Promise<string>
      gitBranches: (cwd: string) => Promise<{ current: string; branches: string[] }>
      gitCheckout: (cwd: string, branch: string) => Promise<void>

      // Agent history — persistent audit trail
      agents: {
        list: (args: { limit?: number; status?: string }) => Promise<AgentMeta[]>
        readLog: (args: { id: string; fromByte?: number }) => Promise<{ content: string; nextByte: number }>
        import: (args: { meta: Partial<AgentMeta>; content: string }) => Promise<AgentMeta>
      }

      // Cost analytics
      cost: {
        summary: () => Promise<CostSummary>
        agentRuns: (limit?: number) => Promise<AgentRunCostRow[]>
        getAgentHistory: () => Promise<AgentCostRecord[]>
      }

      // PR status polling
      pollPrStatuses: (
        prs: { taskId: string; prUrl: string }[]
      ) => Promise<{ taskId: string; merged: boolean; state: string; mergedAt: string | null; mergeableState: string | null }[]>

      // Conflict file detection
      checkConflictFiles: (
        input: { owner: string; repo: string; prNumber: number }
      ) => Promise<{ prNumber: number; files: string[]; baseBranch: string; headBranch: string }>

      // Sprint tasks — Supabase-backed Kanban
      sprint: {
        list: () => Promise<SprintTask[]>
        create: (task: {
          title: string
          repo: string
          prompt?: string
          notes?: string
          spec?: string
          priority?: number
          status?: string
        }) => Promise<unknown>
        update: (id: string, patch: Record<string, unknown>) => Promise<unknown>
        readLog: (agentId: string, fromByte?: number) => Promise<{ content: string; status: string; nextByte: number }>
        readSpecFile: (filePath: string) => Promise<string>
        generatePrompt: (args: {
          taskId: string
          title: string
          repo: string
          templateHint: string
        }) => Promise<{ taskId: string; spec: string; prompt: string }>
        delete: (id: string) => Promise<{ ok: boolean }>
        healthCheck: () => Promise<SprintTask[]>
      }

      // File attachments
      openFileDialog: (
        opts?: { filters?: { name: string; extensions: string[] }[] }
      ) => Promise<string[] | null>
      readFileAsBase64: (
        path: string
      ) => Promise<{ data: string; mimeType: string; name: string }>
      readFileAsText: (path: string) => Promise<{ content: string; name: string }>

      // Gateway RPC
      invokeTool: (tool: string, args?: Record<string, unknown>) => Promise<unknown>
      getSessionHistory: (sessionKey: string) => Promise<unknown>

      // GitHub rate-limit warning push events
      onGitHubRateLimitWarning: (
        cb: (data: { remaining: number; limit: number; resetEpoch: number }) => void
      ) => () => void

      // Open PR list — main-process poller push events
      onPrListUpdated: (cb: (payload: PrListPayload) => void) => () => void
      getPrList: () => Promise<PrListPayload>
      refreshPrList: () => Promise<PrListPayload>

      // Sprint DB file-watcher push events
      onExternalSprintChange: (cb: () => void) => void
      offExternalSprintChange: (cb: () => void) => void

      // Sprint SSE real-time events
      onSprintSseEvent: (cb: (event: { type: string; data: unknown }) => void) => (() => void)

      // Terminal PTY
      terminal: {
        create: (...args: IpcChannelMap['terminal:create']['args']) => Promise<IpcResult<'terminal:create'>>
        write: (id: number, data: string) => void
        resize: (id: number, cols: number, rows: number) => Promise<void>
        kill: (id: number) => Promise<void>
        onData: (id: number, cb: (data: string) => void) => () => void
        onExit: (id: number, cb: () => void) => void
      }
    }
  }
}
