import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AgentCostRecord, AgentMeta, AgentRunCostRow, CostSummary, PrListPayload, SpawnLocalAgentArgs, SprintTask } from '../shared/types'
import type { IpcChannelMap, GitHubFetchInit } from '../shared/ipc-channels'

// Prevent MaxListenersExceededWarning during HMR dev cycles
ipcRenderer.setMaxListeners(25)

/**
 * Type-safe invoke for channels in IpcChannelMap.
 * Channel name typos and payload mismatches are caught at compile time.
 */
function typedInvoke<K extends keyof IpcChannelMap>(
  channel: K,
  ...args: IpcChannelMap[K]['args']
): Promise<IpcChannelMap[K]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

const api = {
  getGatewayUrl: () => typedInvoke('config:getGatewayUrl'),
  saveGatewayConfig: (url: string, token?: string) =>
    typedInvoke('config:saveGateway', url, token),
  testGatewayConnection: (url: string, token?: string) =>
    typedInvoke('gateway:test-connection', url, token),
  signGatewayChallenge: () => typedInvoke('gateway:sign-challenge'),
  getRepoPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('git:getRepoPaths'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('window:openExternal', url),
  listMemoryFiles: (): Promise<
    { path: string; name: string; size: number; modifiedAt: number }[]
  > => ipcRenderer.invoke('memory:listFiles'),
  readMemoryFile: (path: string): Promise<string> =>
    ipcRenderer.invoke('memory:readFile', path),
  writeMemoryFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('memory:writeFile', path, content),
  setTitle: (title: string): void => ipcRenderer.send('window:setTitle', title),

  // GitHub API proxy — all GitHub REST calls routed through main process
  github: {
    fetch: (path: string, init?: GitHubFetchInit) =>
      typedInvoke('github:fetch', path, init)
  },

  // Git client
  gitStatus: (cwd: string) => typedInvoke('git:status', cwd),
  gitDiff: (cwd: string, file?: string) => typedInvoke('git:diff', cwd, file),
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
  spawnLocalAgent: (args: SpawnLocalAgentArgs) =>
    typedInvoke('local:spawnClaudeAgent', args),
  sendToAgent: (pid: number, message: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('local:sendToAgent', { pid, message }),
  isAgentInteractive: (pid: number): Promise<boolean> =>
    ipcRenderer.invoke('local:isInteractive', pid),
  steerAgent: (agentId: string, message: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:steer', { agentId, message }),
  killLocalAgent: (pid: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:killLocal', pid),
  killAgent: (agentId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:kill', agentId),
  tailAgentLog: (args: {
    logPath: string
    fromByte?: number
  }): Promise<{ content: string; nextByte: number }> =>
    ipcRenderer.invoke('local:tailAgentLog', args),

  // Agent history — persistent audit trail
  agents: {
    list: (args: { limit?: number; status?: string }): Promise<AgentMeta[]> =>
      ipcRenderer.invoke('agents:list', args),
    readLog: (args: { id: string; fromByte?: number }): Promise<{ content: string; nextByte: number }> =>
      ipcRenderer.invoke('agents:readLog', args),
    import: (args: { meta: Partial<AgentMeta>; content: string }): Promise<AgentMeta> =>
      ipcRenderer.invoke('agents:import', args),
  },

  // Cost analytics
  cost: {
    summary: (): Promise<CostSummary> =>
      ipcRenderer.invoke('cost:summary'),
    agentRuns: (limit?: number): Promise<AgentRunCostRow[]> =>
      ipcRenderer.invoke('cost:agentRuns', { limit: limit ?? 20 }),
    getAgentHistory: (args?: { limit?: number; offset?: number }): Promise<AgentCostRecord[]> =>
      ipcRenderer.invoke('cost:getAgentHistory', args),
  },

  // PR status polling
  pollPrStatuses: (
    prs: { taskId: string; prUrl: string }[]
  ): Promise<{ taskId: string; merged: boolean; state: string; mergedAt: string | null; mergeableState: string | null }[]> =>
    ipcRenderer.invoke('pr:pollStatuses', prs),

  // Conflict file detection
  checkConflictFiles: (
    input: { owner: string; repo: string; prNumber: number }
  ): Promise<{ prNumber: number; files: string[]; baseBranch: string; headBranch: string }> =>
    ipcRenderer.invoke('pr:checkConflictFiles', input),

  // Sprint tasks — SQLite-backed Kanban
  sprint: {
    list: (): Promise<SprintTask[]> => ipcRenderer.invoke('sprint:list'),
    create: (task: {
      title: string
      repo: string
      prompt?: string
      notes?: string
      spec?: string
      priority?: number
      status?: string
    }): Promise<unknown> => ipcRenderer.invoke('sprint:create', task),
    update: (id: string, patch: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke('sprint:update', id, patch),
    readLog: (agentId: string, fromByte?: number): Promise<{ content: string; status: string; nextByte: number }> =>
      ipcRenderer.invoke('sprint:readLog', agentId, fromByte),
    readSpecFile: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('sprint:readSpecFile', filePath),
    generatePrompt: (args: {
      taskId: string
      title: string
      repo: string
      templateHint: string
    }): Promise<{ taskId: string; spec: string; prompt: string }> =>
      ipcRenderer.invoke('sprint:generatePrompt', args),
    delete: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('sprint:delete', id),
    healthCheck: (): Promise<SprintTask[]> =>
      ipcRenderer.invoke('sprint:healthCheck'),
  },

  // File attachments
  openFileDialog: (
    opts?: { filters?: { name: string; extensions: string[] }[] }
  ): Promise<string[] | null> => ipcRenderer.invoke('fs:openFileDialog', opts),
  readFileAsBase64: (
    path: string
  ): Promise<{ data: string; mimeType: string; name: string }> =>
    ipcRenderer.invoke('fs:readFileAsBase64', path),
  readFileAsText: (
    path: string
  ): Promise<{ content: string; name: string }> =>
    ipcRenderer.invoke('fs:readFileAsText', path),

  // Gateway tool invocation — proxied through main process to avoid CORS
  invokeTool: (tool: string, args?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('gateway:invoke', tool, args ?? {}),
  getSessionHistory: (sessionKey: string): Promise<unknown> =>
    ipcRenderer.invoke('gateway:getSessionHistory', sessionKey),

  // GitHub rate-limit warning push events
  onGitHubRateLimitWarning: (
    cb: (data: { remaining: number; limit: number; resetEpoch: number }) => void
  ): (() => void) => {
    const listener = (_e: unknown, data: { remaining: number; limit: number; resetEpoch: number }): void => cb(data)
    ipcRenderer.on('github:rateLimitWarning', listener)
    return () => ipcRenderer.removeListener('github:rateLimitWarning', listener)
  },

  // GitHub token expired push event
  onGitHubTokenExpired: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('github:tokenExpired', listener)
    return () => ipcRenderer.removeListener('github:tokenExpired', listener)
  },

  // Open PR list — main-process poller push events
  onPrListUpdated: (cb: (payload: PrListPayload) => void): (() => void) => {
    const listener = (_e: unknown, data: PrListPayload): void => cb(data)
    ipcRenderer.on('pr:listUpdated', listener)
    return () => ipcRenderer.removeListener('pr:listUpdated', listener)
  },
  getPrList: (): Promise<PrListPayload> => ipcRenderer.invoke('pr:getList'),
  refreshPrList: (): Promise<PrListPayload> => ipcRenderer.invoke('pr:refreshList'),

  // Sprint DB file-watcher push events
  onExternalSprintChange: (cb: () => void): void => {
    ipcRenderer.on('sprint:externalChange', cb)
  },
  offExternalSprintChange: (cb: () => void): void => {
    ipcRenderer.removeListener('sprint:externalChange', cb)
  },

  // Sprint SSE real-time events
  onSprintSseEvent: (cb: (event: { type: string; data: unknown }) => void): (() => void) => {
    const listener = (_e: unknown, ev: { type: string; data: unknown }): void => cb(ev)
    ipcRenderer.on('sprint:sseEvent', listener)
    return () => ipcRenderer.removeListener('sprint:sseEvent', listener)
  },

  // Terminal PTY
  terminal: {
    create: (opts: { cols: number; rows: number; shell?: string }) =>
      typedInvoke('terminal:create', opts),
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
