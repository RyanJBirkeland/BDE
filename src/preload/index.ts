import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AgentMeta, PrListPayload, SpawnLocalAgentArgs } from '../shared/types'
import type { IpcChannelMap, GitHubFetchInit } from '../shared/ipc-channels'
import type { AgentEvent } from '../main/agents/types'

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
  getRepoPaths: () => typedInvoke('git:getRepoPaths'),
  openExternal: (url: string) => typedInvoke('window:openExternal', url),
  listMemoryFiles: () => typedInvoke('memory:listFiles'),
  readMemoryFile: (path: string) => typedInvoke('memory:readFile', path),
  writeMemoryFile: (path: string, content: string) =>
    typedInvoke('memory:writeFile', path, content),
  setTitle: (title: string): void => ipcRenderer.send('window:setTitle', title),

  // Settings CRUD
  settings: {
    get: (key: string) => typedInvoke('settings:get', key),
    set: (key: string, value: string) => typedInvoke('settings:set', key, value),
    getJson: (key: string) => typedInvoke('settings:getJson', key),
    setJson: (key: string, value: unknown) => typedInvoke('settings:setJson', key, value),
    delete: (key: string) => typedInvoke('settings:delete', key),
  },

  // GitHub API proxy — all GitHub REST calls routed through main process
  github: {
    fetch: (path: string, init?: GitHubFetchInit) =>
      typedInvoke('github:fetch', path, init)
  },

  // Git client
  gitStatus: (cwd: string) => typedInvoke('git:status', cwd),
  gitDiff: (cwd: string, file?: string) => typedInvoke('git:diff', cwd, file),
  gitStage: (cwd: string, files: string[]) => typedInvoke('git:stage', cwd, files),
  gitUnstage: (cwd: string, files: string[]) => typedInvoke('git:unstage', cwd, files),
  gitCommit: (cwd: string, message: string) => typedInvoke('git:commit', cwd, message),
  gitPush: (cwd: string) => typedInvoke('git:push', cwd),
  gitBranches: (cwd: string) => typedInvoke('git:branches', cwd),
  gitCheckout: (cwd: string, branch: string) => typedInvoke('git:checkout', cwd, branch),

  // Agent runtime config
  getAgentConfig: () => typedInvoke('config:getAgentConfig'),
  saveAgentConfig: (config: { binary: string; permissionMode: string }) =>
    typedInvoke('config:saveAgentConfig', config),

  // Local agent process detection + spawning
  getAgentProcesses: () => typedInvoke('local:getAgentProcesses'),
  spawnLocalAgent: (args: SpawnLocalAgentArgs) =>
    typedInvoke('local:spawnClaudeAgent', args),
  sendToAgent: (pid: number, message: string) =>
    typedInvoke('local:sendToAgent', { pid, message }),
  isAgentInteractive: (pid: number) => typedInvoke('local:isInteractive', pid),
  steerAgent: (agentId: string, message: string) =>
    typedInvoke('agent:steer', { agentId, message }),
  killLocalAgent: (pid: number) => typedInvoke('agent:killLocal', pid),
  killAgent: (agentId: string) => typedInvoke('agent:kill', agentId),
  tailAgentLog: (args: { logPath: string; fromByte?: number }) =>
    typedInvoke('local:tailAgentLog', args),

  // Agent history — persistent audit trail
  agents: {
    list: (args: { limit?: number; status?: string }) =>
      typedInvoke('agents:list', args),
    readLog: (args: { id: string; fromByte?: number }) =>
      typedInvoke('agents:readLog', args),
    import: (args: { meta: Partial<AgentMeta>; content: string }) =>
      typedInvoke('agents:import', args),
  },

  // Cost analytics
  cost: {
    summary: () => typedInvoke('cost:summary'),
    agentRuns: (limit?: number) =>
      typedInvoke('cost:agentRuns', { limit: limit ?? 20 }),
    getAgentHistory: (args?: { limit?: number; offset?: number }) =>
      typedInvoke('cost:getAgentHistory', args),
  },

  // PR status polling
  pollPrStatuses: (prs: { taskId: string; prUrl: string }[]) =>
    typedInvoke('pr:pollStatuses', prs),

  // Conflict file detection
  checkConflictFiles: (input: { owner: string; repo: string; prNumber: number }) =>
    typedInvoke('pr:checkConflictFiles', input),

  // Sprint tasks — SQLite-backed Kanban
  sprint: {
    list: () => typedInvoke('sprint:list'),
    create: (task: {
      title: string
      repo: string
      prompt?: string
      notes?: string
      spec?: string
      priority?: number
      status?: string
      template_name?: string
    }) => typedInvoke('sprint:create', task),
    claimTask: (taskId: string) => typedInvoke('sprint:claimTask', taskId),
    update: (id: string, patch: Record<string, unknown>) =>
      typedInvoke('sprint:update', id, patch),
    readLog: (agentId: string, fromByte?: number) =>
      typedInvoke('sprint:readLog', agentId, fromByte),
    readSpecFile: (filePath: string) => typedInvoke('sprint:readSpecFile', filePath),
    generatePrompt: (args: {
      taskId: string
      title: string
      repo: string
      templateHint: string
    }) => typedInvoke('sprint:generatePrompt', args),
    delete: (id: string) => typedInvoke('sprint:delete', id),
    healthCheck: () => typedInvoke('sprint:healthCheck'),
  },

  // File attachments
  openFileDialog: (opts?: { filters?: { name: string; extensions: string[] }[] }) =>
    typedInvoke('fs:openFileDialog', opts),
  readFileAsBase64: (path: string) => typedInvoke('fs:readFileAsBase64', path),
  readFileAsText: (path: string) => typedInvoke('fs:readFileAsText', path),
  openDirectoryDialog: () => typedInvoke('fs:openDirectoryDialog'),

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
  getPrList: () => typedInvoke('pr:getList'),
  refreshPrList: () => typedInvoke('pr:refreshList'),

  // Sprint DB file-watcher push events
  onExternalSprintChange: (cb: () => void): (() => void) => {
    ipcRenderer.on('sprint:externalChange', cb)
    return () => ipcRenderer.removeListener('sprint:externalChange', cb)
  },

  // Agent event streaming (Phase 2)
  agentEvents: {
    onEvent: (
      callback: (payload: { agentId: string; event: AgentEvent }) => void
    ): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { agentId: string; event: AgentEvent }): void =>
        callback(payload)
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    },
    getHistory: (agentId: string) => typedInvoke('agent:history', agentId),
  },

  // Auth status
  authStatus: () => typedInvoke('auth:status'),

  // Agent Manager
  agentManager: {
    status: () => typedInvoke('agent-manager:status'),
    kill: (taskId: string) => typedInvoke('agent-manager:kill', taskId),
  },

  // Template CRUD (Phase 2)
  templates: {
    list: () => typedInvoke('templates:list'),
    save: (template: import('../shared/types').TaskTemplate) => typedInvoke('templates:save', template),
    delete: (name: string) => typedInvoke('templates:delete', name),
    reset: (name: string) => typedInvoke('templates:reset', name),
  },

  // Terminal PTY
  terminal: {
    create: (opts: { cols: number; rows: number; shell?: string }) =>
      typedInvoke('terminal:create', opts),
    write: (id: number, data: string): void =>
      ipcRenderer.send('terminal:write', { id, data }),
    resize: (id: number, cols: number, rows: number) =>
      typedInvoke('terminal:resize', { id, cols, rows }),
    kill: (id: number) => typedInvoke('terminal:kill', id),
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
