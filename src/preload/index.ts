import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AgentMeta } from '../shared/types'

const api = {
  getGatewayConfig: (): Promise<{ url: string; token: string }> =>
    ipcRenderer.invoke('get-gateway-config'),
  getGitHubToken: (): Promise<string | null> => ipcRenderer.invoke('get-github-token'),
  saveGatewayConfig: (url: string, token: string): Promise<void> =>
    ipcRenderer.invoke('save-gateway-config', url, token),
  getSupabaseConfig: (): Promise<{ url: string; anonKey: string } | null> =>
    ipcRenderer.invoke('get-supabase-config'),
  getRepoPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-repo-paths'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  listMemoryFiles: (): Promise<
    { path: string; name: string; size: number; modifiedAt: number }[]
  > => ipcRenderer.invoke('list-memory-files'),
  readMemoryFile: (path: string): Promise<string> =>
    ipcRenderer.invoke('read-memory-file', path),
  writeMemoryFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-memory-file', path, content),
  setTitle: (title: string): void => ipcRenderer.send('set-title', title),

  // Git client
  gitStatus: (
    cwd: string
  ): Promise<{ files: { path: string; status: string; staged: boolean }[] }> =>
    ipcRenderer.invoke('git:status', cwd),
  gitDiff: (cwd: string, file?: string): Promise<string> =>
    ipcRenderer.invoke('git:diff', cwd, file),
  gitStage: (cwd: string, files: string[]): Promise<void> =>
    ipcRenderer.invoke('git:stage', cwd, files),
  gitUnstage: (cwd: string, files: string[]): Promise<void> =>
    ipcRenderer.invoke('git:unstage', cwd, files),
  gitCommit: (cwd: string, message: string): Promise<void> =>
    ipcRenderer.invoke('git:commit', cwd, message),
  gitPush: (cwd: string): Promise<string> => ipcRenderer.invoke('git:push', cwd),
  gitBranches: (cwd: string): Promise<{ current: string; branches: string[] }> =>
    ipcRenderer.invoke('git:branches', cwd),
  gitCheckout: (cwd: string, branch: string): Promise<void> =>
    ipcRenderer.invoke('git:checkout', cwd, branch),

  // Local agent process detection + spawning
  getAgentProcesses: (): Promise<
    {
      pid: number
      bin: string
      args: string
      cwd: string | null
      startedAt: number
      cpuPct: number
      memMb: number
    }[]
  > => ipcRenderer.invoke('local:getAgentProcesses'),
  spawnLocalAgent: (args: {
    task: string
    repoPath: string
    model?: string
  }): Promise<{ pid: number; logPath: string; id: string; interactive: boolean }> =>
    ipcRenderer.invoke('local:spawnClaudeAgent', args),
  sendToAgent: (pid: number, message: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('local:sendToAgent', { pid, message }),
  isAgentInteractive: (pid: number): Promise<boolean> =>
    ipcRenderer.invoke('local:isInteractive', pid),
  killLocalAgent: (pid: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kill-local-agent', pid),
  tailAgentLog: (args: {
    logPath: string
    fromByte?: number
  }): Promise<{ content: string; nextByte: number }> =>
    ipcRenderer.invoke('local:tailAgentLog', args),

  // Agent history — persistent audit trail
  agents: {
    list: (args: { limit?: number; status?: string }): Promise<AgentMeta[]> =>
      ipcRenderer.invoke('agents:list', args),
    getMeta: (args: { id: string }): Promise<AgentMeta | null> =>
      ipcRenderer.invoke('agents:getMeta', args),
    readLog: (args: { id: string; fromByte?: number }): Promise<{ content: string; nextByte: number }> =>
      ipcRenderer.invoke('agents:readLog', args),
    import: (args: { meta: Partial<AgentMeta>; content: string }): Promise<AgentMeta> =>
      ipcRenderer.invoke('agents:import', args),
    markDone: (args: { id: string; exitCode: number }): Promise<void> =>
      ipcRenderer.invoke('agents:markDone', args)
  },

  // PR status polling
  pollPrStatuses: (
    prs: { taskId: string; prUrl: string }[]
  ): Promise<{ taskId: string; merged: boolean; state: string; mergedAt: string | null }[]> =>
    ipcRenderer.invoke('poll-pr-statuses', prs),

  // Sprint tasks — Supabase-backed Kanban
  sprint: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('sprint:list'),
    create: (task: {
      title: string
      repo: string
      prompt?: string
      description?: string
      spec?: string
      priority?: number
      status?: string
    }): Promise<unknown> => ipcRenderer.invoke('sprint:create', task),
    update: (id: string, patch: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke('sprint:update', id, patch),
    delete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('sprint:delete', id),
    readLog: (agentId: string): Promise<{ content: string; status: string }> =>
      ipcRenderer.invoke('sprint:readLog', agentId),
  },

  // Gateway tool invocation — proxied through main process to avoid CORS
  invokeTool: (tool: string, args?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('gateway:invoke', tool, args ?? {}),

  // Terminal PTY
  terminal: {
    create: (opts: { cols: number; rows: number; shell?: string }): Promise<number> =>
      ipcRenderer.invoke('terminal:create', opts),
    write: (id: number, data: string): void =>
      ipcRenderer.send('terminal:write', { id, data }),
    resize: (id: number, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
    kill: (id: number): Promise<void> => ipcRenderer.invoke('terminal:kill', id),
    onData: (id: number, cb: (data: string) => void): (() => void) => {
      const listener = (_: unknown, data: string): void => cb(data)
      ipcRenderer.on('terminal:data:' + id, listener)
      return () => ipcRenderer.removeListener('terminal:data:' + id, listener)
    },
    onExit: (id: number, cb: () => void): void => {
      ipcRenderer.once('terminal:exit:' + id, cb)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
