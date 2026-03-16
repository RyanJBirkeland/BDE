import { ElectronAPI } from '@electron-toolkit/preload'

export interface AgentMeta {
  id: string
  pid: number | null
  bin: string
  model: string
  repo: string
  repoPath: string
  task: string
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  status: 'running' | 'done' | 'failed' | 'unknown'
  logPath: string
  source: 'bde' | 'openclaw' | 'external'
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getGatewayConfig: () => Promise<{ url: string; token: string }>
      getGitHubToken: () => Promise<string | null>
      saveGatewayConfig: (url: string, token: string) => Promise<void>
      getSupabaseConfig: () => Promise<{ url: string; anonKey: string } | null>
      getRepoPaths: () => Promise<Record<string, string>>
      readSprintMd: (repoPath: string) => Promise<string>
      openExternal: (url: string) => Promise<void>
      listMemoryFiles: () => Promise<
        { path: string; name: string; size: number; modifiedAt: number }[]
      >
      readMemoryFile: (path: string) => Promise<string>
      writeMemoryFile: (path: string, content: string) => Promise<void>
      getDiff: (repoPath: string, base?: string) => Promise<string>
      getBranch: (repoPath: string) => Promise<string>
      getLog: (repoPath: string, n?: number) => Promise<string>
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

      // Gateway RPC
      invokeTool: (tool: string, args?: Record<string, unknown>) => Promise<unknown>

      // Session history (agent output tabs)
      getSessionHistory: (sessionKey: string) => Promise<any[]>

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
