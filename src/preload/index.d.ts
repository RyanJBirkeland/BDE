import { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentMeta } from '../shared/types'

export type { AgentMeta }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getGatewayConfig: () => Promise<{ url: string; token: string }>
      getGitHubToken: () => Promise<string | null>
      saveGatewayConfig: (url: string, token: string) => Promise<void>
      getSupabaseConfig: () => Promise<{ url: string; anonKey: string } | null>
      getRepoPaths: () => Promise<Record<string, string>>
      openExternal: (url: string) => Promise<void>
      listMemoryFiles: () => Promise<
        { path: string; name: string; size: number; modifiedAt: number }[]
      >
      readMemoryFile: (path: string) => Promise<string>
      writeMemoryFile: (path: string, content: string) => Promise<void>
      setTitle: (title: string) => void

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
      spawnLocalAgent: (args: {
        task: string
        repoPath: string
        model?: string
      }) => Promise<{ pid: number; logPath: string; id: string; interactive: boolean }>
      sendToAgent: (pid: number, message: string) => Promise<{ ok: boolean; error?: string }>
      isAgentInteractive: (pid: number) => Promise<boolean>
      killLocalAgent: (pid: number) => Promise<{ ok: boolean; error?: string }>
      tailAgentLog: (args: {
        logPath: string
        fromByte?: number
      }) => Promise<{ content: string; nextByte: number }>

      // Git client
      gitStatus: (
        cwd: string
      ) => Promise<{ files: { path: string; status: string; staged: boolean }[] }>
      gitDiff: (cwd: string, file?: string) => Promise<string>
      gitStage: (cwd: string, files: string[]) => Promise<void>
      gitUnstage: (cwd: string, files: string[]) => Promise<void>
      gitCommit: (cwd: string, message: string) => Promise<void>
      gitPush: (cwd: string) => Promise<string>
      gitBranches: (cwd: string) => Promise<{ current: string; branches: string[] }>
      gitCheckout: (cwd: string, branch: string) => Promise<void>

      // Agent history — persistent audit trail
      agents: {
        list: (args: { limit?: number; status?: string }) => Promise<AgentMeta[]>
        getMeta: (args: { id: string }) => Promise<AgentMeta | null>
        readLog: (args: { id: string; fromByte?: number }) => Promise<{ content: string; nextByte: number }>
        import: (args: { meta: Partial<AgentMeta>; content: string }) => Promise<AgentMeta>
        markDone: (args: { id: string; exitCode: number }) => Promise<void>
      }

      // PR status polling
      pollPrStatuses: (
        prs: { taskId: string; prUrl: string }[]
      ) => Promise<{ taskId: string; merged: boolean; state: string; mergedAt: string | null }[]>

      // Sprint tasks — Supabase-backed Kanban
      sprint: {
        list: () => Promise<unknown[]>
        create: (task: {
          title: string
          repo: string
          prompt?: string
          description?: string
          spec?: string
          priority?: number
          status?: string
        }) => Promise<unknown>
        update: (id: string, patch: Record<string, unknown>) => Promise<unknown>
        delete: (id: string) => Promise<{ ok: boolean }>
        readLog: (agentId: string) => Promise<{ content: string; status: string }>
      }

      // Gateway RPC
      invokeTool: (tool: string, args?: Record<string, unknown>) => Promise<unknown>

      // Terminal PTY
      terminal: {
        create: (opts: { cols: number; rows: number; shell?: string }) => Promise<number>
        write: (id: number, data: string) => void
        resize: (id: number, cols: number, rows: number) => Promise<void>
        kill: (id: number) => Promise<void>
        onData: (id: number, cb: (data: string) => void) => () => void
        onExit: (id: number, cb: () => void) => void
      }
    }
  }
}
