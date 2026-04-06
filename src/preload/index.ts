import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentMeta,
  PrListPayload,
  SpawnLocalAgentArgs,
  AgentEvent,
  BatchOperation
} from '../shared/types'
import type { IpcChannelMap, GitHubFetchInit } from '../shared/ipc-channels'
import type { WorkflowTemplate } from '../shared/workflow-types'

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
  openPlaygroundInBrowser: (html: string) => typedInvoke('playground:openInBrowser', html),
  listMemoryFiles: () => typedInvoke('memory:listFiles'),
  readMemoryFile: (path: string) => typedInvoke('memory:readFile', path),
  writeMemoryFile: (path: string, content: string) =>
    typedInvoke('memory:writeFile', path, content),
  searchMemory: (query: string) => typedInvoke('memory:search', query),
  getActiveMemoryFiles: () => typedInvoke('memory:getActiveFiles'),
  setMemoryFileActive: (path: string, active: boolean) =>
    typedInvoke('memory:setFileActive', path, active),
  setTitle: (title: string): void => ipcRenderer.send('window:setTitle', title),

  // Settings CRUD
  settings: {
    get: (key: string) => typedInvoke('settings:get', key),
    set: (key: string, value: string) => typedInvoke('settings:set', key, value),
    getJson: (key: string) => typedInvoke('settings:getJson', key),
    setJson: (key: string, value: unknown) => typedInvoke('settings:setJson', key, value),
    delete: (key: string) => typedInvoke('settings:delete', key),
    saveProfile: (name: string) => typedInvoke('settings:saveProfile', name),
    loadProfile: (name: string) => typedInvoke('settings:loadProfile', name),
    applyProfile: (name: string) => typedInvoke('settings:applyProfile', name),
    listProfiles: () => typedInvoke('settings:listProfiles'),
    deleteProfile: (name: string) => typedInvoke('settings:deleteProfile', name)
  },

  // Claude CLI config (~/.claude/settings.json)
  claudeConfig: {
    get: () => typedInvoke('claude:getConfig'),
    setPermissions: (permissions: { allow: string[]; deny: string[] }) =>
      typedInvoke('claude:setPermissions', permissions)
  },

  // Webhook management
  webhooks: {
    list: () => typedInvoke('webhook:list'),
    create: (payload: { url: string; events: string[]; secret?: string }) =>
      typedInvoke('webhook:create', payload),
    update: (payload: {
      id: string
      url?: string
      events?: string[]
      secret?: string | null
      enabled?: boolean
    }) => typedInvoke('webhook:update', payload),
    delete: (payload: { id: string }) => typedInvoke('webhook:delete', payload),
    test: (payload: { id: string }) => typedInvoke('webhook:test', payload)
  },

  // GitHub API proxy — all GitHub REST calls routed through main process
  github: {
    fetch: (path: string, init?: GitHubFetchInit) => typedInvoke('github:fetch', path, init)
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

  // Local agent process detection + spawning
  getAgentProcesses: () => typedInvoke('local:getAgentProcesses'),
  spawnLocalAgent: (args: SpawnLocalAgentArgs) => typedInvoke('local:spawnClaudeAgent', args),
  steerAgent: (agentId: string, message: string) =>
    typedInvoke('agent:steer', { agentId, message }),
  killAgent: (agentId: string) => typedInvoke('agent:kill', agentId),
  tailAgentLog: (args: { logPath: string; fromByte?: number }) =>
    typedInvoke('local:tailAgentLog', args),

  // Agent history — persistent audit trail
  agents: {
    list: (args: { limit?: number; status?: string }) => typedInvoke('agents:list', args),
    readLog: (args: { id: string; fromByte?: number }) => typedInvoke('agents:readLog', args),
    import: (args: { meta: Partial<AgentMeta>; content: string }) =>
      typedInvoke('agents:import', args)
  },

  // Cost analytics
  cost: {
    summary: () => typedInvoke('cost:summary'),
    agentRuns: (limit?: number) => typedInvoke('cost:agentRuns', { limit: limit ?? 20 }),
    getAgentHistory: (args?: { limit?: number; offset?: number }) =>
      typedInvoke('cost:getAgentHistory', args)
  },

  // PR status polling
  pollPrStatuses: (prs: { taskId: string; prUrl: string }[]) => typedInvoke('pr:pollStatuses', prs),

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
      playground_enabled?: boolean
    }) => typedInvoke('sprint:create', task),
    createWorkflow: (template: WorkflowTemplate) => typedInvoke('sprint:createWorkflow', template),
    claimTask: (taskId: string) => typedInvoke('sprint:claimTask', taskId),
    update: (id: string, patch: Record<string, unknown>) => typedInvoke('sprint:update', id, patch),
    readLog: (agentId: string, fromByte?: number) =>
      typedInvoke('sprint:readLog', agentId, fromByte),
    readSpecFile: (filePath: string) => typedInvoke('sprint:readSpecFile', filePath),
    generatePrompt: (args: { taskId: string; title: string; repo: string; templateHint: string }) =>
      typedInvoke('sprint:generatePrompt', args),
    delete: (id: string) => typedInvoke('sprint:delete', id),
    healthCheck: () => typedInvoke('sprint:healthCheck'),
    validateDependencies: (taskId: string, deps: Array<{ id: string; type: 'hard' | 'soft' }>) =>
      typedInvoke('sprint:validateDependencies', taskId, deps),
    unblockTask: (taskId: string) => typedInvoke('sprint:unblockTask', taskId),
    retry: (taskId: string) => typedInvoke('sprint:retry', taskId),
    batchUpdate: (operations: BatchOperation[]) => typedInvoke('sprint:batchUpdate', operations),
    batchImport: (
      tasks: Array<{
        title: string
        repo: string
        prompt?: string
        spec?: string
        status?: string
        dependsOnIndices?: number[]
        depType?: 'hard' | 'soft'
        playgroundEnabled?: boolean
        model?: string
        tags?: string[]
        priority?: number
        templateName?: string
      }>
    ) => typedInvoke('sprint:batchImport', tasks),
    exportTasks: (format: 'json' | 'csv') => typedInvoke('sprint:exportTasks', format),
    exportTaskHistory: (taskId: string) => typedInvoke('sprint:exportTaskHistory', taskId),
    failureBreakdown: () => typedInvoke('sprint:failureBreakdown'),
    getSuccessRateBySpecType: () => typedInvoke('sprint:getSuccessRateBySpecType'),
    getChanges: (taskId: string) => typedInvoke('sprint:getChanges', taskId)
  },

  // Task groups
  groups: {
    create: (input: { name: string; icon?: string; accent_color?: string; goal?: string }) =>
      typedInvoke('groups:create', input),
    list: () => typedInvoke('groups:list'),
    get: (id: string) => typedInvoke('groups:get', id),
    update: (
      id: string,
      patch: {
        name?: string
        icon?: string
        accent_color?: string
        goal?: string
        status?: 'draft' | 'ready' | 'in-pipeline' | 'completed'
      }
    ) => typedInvoke('groups:update', id, patch),
    delete: (id: string) => typedInvoke('groups:delete', id),
    addTask: (taskId: string, groupId: string) => typedInvoke('groups:addTask', taskId, groupId),
    removeTask: (taskId: string) => typedInvoke('groups:removeTask', taskId),
    getGroupTasks: (groupId: string) => typedInvoke('groups:getGroupTasks', groupId),
    queueAll: (groupId: string) => typedInvoke('groups:queueAll', groupId),
    reorderTasks: (groupId: string, orderedTaskIds: string[]) =>
      typedInvoke('groups:reorderTasks', groupId, orderedTaskIds)
  },

  // Plan import
  planner: {
    import: (repo: string) => typedInvoke('planner:import', repo)
  },

  // File attachments
  openFileDialog: (opts?: { filters?: { name: string; extensions: string[] }[] }) =>
    typedInvoke('fs:openFileDialog', opts),
  readFileAsBase64: (path: string) => typedInvoke('fs:readFileAsBase64', path),
  readFileAsText: (path: string) => typedInvoke('fs:readFileAsText', path),
  openDirectoryDialog: () => typedInvoke('fs:openDirectoryDialog'),
  readDir: (dirPath: string) => typedInvoke('fs:readDir', dirPath),
  readFile: (filePath: string) => typedInvoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => typedInvoke('fs:writeFile', filePath, content),
  watchDir: (dirPath: string) => typedInvoke('fs:watchDir', dirPath),
  unwatchDir: () => typedInvoke('fs:unwatchDir'),
  createFile: (filePath: string) => typedInvoke('fs:createFile', filePath),
  createDir: (dirPath: string) => typedInvoke('fs:createDir', dirPath),
  rename: (oldPath: string, newPath: string) => typedInvoke('fs:rename', oldPath, newPath),
  deletePath: (targetPath: string) => typedInvoke('fs:delete', targetPath),
  stat: (targetPath: string) => typedInvoke('fs:stat', targetPath),
  listFiles: (rootPath: string) => typedInvoke('fs:listFiles', rootPath),
  onDirChanged: (callback: (dirPath: string) => void) => {
    const handler = (_event: unknown, dirPath: string): void => callback(dirPath)
    ipcRenderer.on('fs:dirChanged', handler)
    return () => {
      ipcRenderer.removeListener('fs:dirChanged', handler)
    }
  },

  // GitHub rate-limit warning push events
  onGitHubRateLimitWarning: (
    cb: (data: { remaining: number; limit: number; resetEpoch: number }) => void
  ): (() => void) => {
    const listener = (
      _e: unknown,
      data: { remaining: number; limit: number; resetEpoch: number }
    ): void => cb(data)
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
      const handler = (
        _e: IpcRendererEvent,
        payload: { agentId: string; event: AgentEvent }
      ): void => callback(payload)
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    },
    getHistory: (agentId: string) => typedInvoke('agent:history', agentId)
  },

  // Auth status
  authStatus: () => typedInvoke('auth:status'),

  // Agent Manager
  agentManager: {
    status: () => typedInvoke('agent-manager:status'),
    kill: (taskId: string) => typedInvoke('agent-manager:kill', taskId),
    getMetrics: () => typedInvoke('agent-manager:metrics')
  },

  // Template CRUD (Phase 2)
  templates: {
    list: () => typedInvoke('templates:list'),
    save: (template: import('../shared/types').TaskTemplate) =>
      typedInvoke('templates:save', template),
    delete: (name: string) => typedInvoke('templates:delete', name),
    reset: (name: string) => typedInvoke('templates:reset', name)
  },

  // Terminal PTY
  terminal: {
    create: (opts: { cols: number; rows: number; shell?: string }) =>
      typedInvoke('terminal:create', opts),
    write: (id: number, data: string): void => ipcRenderer.send('terminal:write', { id, data }),
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
  },

  // Dashboard analytics
  dashboard: {
    completionsPerHour: () => typedInvoke('agent:completionsPerHour'),
    recentEvents: (limit?: number) => typedInvoke('agent:recentEvents', limit),
    dailySuccessRate: (days?: number) => typedInvoke('dashboard:dailySuccessRate', days),
    burndown: () => typedInvoke('sprint:burndown')
  },

  // Task Workbench
  workbench: {
    chat: (input: {
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
      formContext: { title: string; repo: string; spec: string }
    }) => typedInvoke('workbench:chat', input),
    generateSpec: (input: { title: string; repo: string; templateHint: string }) =>
      typedInvoke('workbench:generateSpec', input),
    checkSpec: (input: { title: string; repo: string; spec: string; specType?: string | null }) =>
      typedInvoke('workbench:checkSpec', input),
    checkOperational: (input: { repo: string }) => typedInvoke('workbench:checkOperational', input),
    researchRepo: (input: { query: string; repo: string }) =>
      typedInvoke('workbench:researchRepo', input),
    chatStream: (input: {
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
      formContext: { title: string; repo: string; spec: string }
    }) => typedInvoke('workbench:chatStream', input),
    cancelStream: (streamId: string) => typedInvoke('workbench:cancelStream', streamId),
    extractPlan: (markdown: string) => typedInvoke('workbench:extractPlan', markdown),
    onChatChunk: (
      cb: (data: {
        streamId: string
        chunk: string
        done: boolean
        fullText?: string
        error?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _e: unknown,
        data: {
          streamId: string
          chunk: string
          done: boolean
          fullText?: string
          error?: string
        }
      ): void => cb(data)
      ipcRenderer.on('workbench:chatChunk', listener)
      return () => ipcRenderer.removeListener('workbench:chatChunk', listener)
    }
  },

  // Tear-off window management
  tearoff: {
    create: (payload: {
      view: string
      screenX: number
      screenY: number
      sourcePanelId: string
      sourceTabIndex: number
    }) => typedInvoke('tearoff:create', payload),
    closeConfirmed: (payload: { action: 'return' | 'close'; remember: boolean }) =>
      typedInvoke('tearoff:closeConfirmed', payload),
    returnToMain: (windowId: string) => ipcRenderer.send('tearoff:returnToMain', { windowId }),
    onTabRemoved: (
      cb: (payload: { sourcePanelId: string; sourceTabIndex: number }) => void
    ): (() => void) => {
      const handler = (
        _e: IpcRendererEvent,
        payload: { sourcePanelId: string; sourceTabIndex: number }
      ): void => cb(payload)
      ipcRenderer.on('tearoff:tabRemoved', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:tabRemoved', handler)
      }
    },
    onTabReturned: (cb: (payload: { view: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { view: string }): void => cb(payload)
      ipcRenderer.on('tearoff:tabReturned', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:tabReturned', handler)
      }
    },
    onConfirmClose: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('tearoff:confirmClose', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:confirmClose', handler)
      }
    },
    // Cross-window drag
    startCrossWindowDrag: (payload: { windowId: string; viewKey: string }) =>
      typedInvoke('tearoff:startCrossWindowDrag', payload),
    onDragIn: (
      cb: (payload: { viewKey: string; localX: number; localY: number }) => void
    ): (() => void) => {
      const handler = (
        _e: IpcRendererEvent,
        payload: { viewKey: string; localX: number; localY: number }
      ): void => cb(payload)
      ipcRenderer.on('tearoff:dragIn', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:dragIn', handler)
      }
    },
    onDragMove: (cb: (payload: { localX: number; localY: number }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: { localX: number; localY: number }): void =>
        cb(payload)
      ipcRenderer.on('tearoff:dragMove', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:dragMove', handler)
      }
    },
    onDragCancel: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('tearoff:dragCancel', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:dragCancel', handler)
      }
    },
    sendDropComplete: (payload: { viewKey: string; targetPanelId: string; zone: string }) =>
      ipcRenderer.send('tearoff:dropComplete', payload),
    onCrossWindowDrop: (
      cb: (payload: { view: string; targetPanelId: string; zone: string }) => void
    ): (() => void) => {
      const handler = (
        _e: IpcRendererEvent,
        payload: { view: string; targetPanelId: string; zone: string }
      ): void => cb(payload)
      ipcRenderer.on('tearoff:crossWindowDrop', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:crossWindowDrop', handler)
      }
    },
    onDragDone: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('tearoff:dragDone', handler)
      return () => {
        ipcRenderer.removeListener('tearoff:dragDone', handler)
      }
    },
    sendDragCancel: () => ipcRenderer.send('tearoff:dragCancelFromRenderer'),
    returnAll: (payload: { windowId: string; views: string[] }) =>
      ipcRenderer.send('tearoff:returnAll', payload),
    viewsChanged: (payload: { windowId: string; views: string[] }) =>
      ipcRenderer.send('tearoff:viewsChanged', payload)
  },

  // Code Review
  review: {
    getDiff: (payload: { worktreePath: string; base: string }) =>
      typedInvoke('review:getDiff', payload),
    getCommits: (payload: { worktreePath: string; base: string }) =>
      typedInvoke('review:getCommits', payload),
    getFileDiff: (payload: { worktreePath: string; filePath: string; base: string }) =>
      typedInvoke('review:getFileDiff', payload),
    mergeLocally: (payload: { taskId: string; strategy: 'squash' | 'merge' | 'rebase' }) =>
      typedInvoke('review:mergeLocally', payload),
    createPr: (payload: { taskId: string; title: string; body: string }) =>
      typedInvoke('review:createPr', payload),
    requestRevision: (payload: { taskId: string; feedback: string; mode: 'resume' | 'fresh' }) =>
      typedInvoke('review:requestRevision', payload),
    discard: (payload: { taskId: string }) => typedInvoke('review:discard', payload),
    shipIt: (payload: { taskId: string; strategy: 'squash' | 'merge' | 'rebase' }) =>
      typedInvoke('review:shipIt', payload),
    generateSummary: (payload: { taskId: string }) =>
      typedInvoke('review:generateSummary', payload),
    checkAutoReview: (payload: { taskId: string }) =>
      typedInvoke('review:checkAutoReview', payload),
    rebase: (payload: { taskId: string }) => typedInvoke('review:rebase', payload),
    checkFreshness: (payload: { taskId: string }) =>
      typedInvoke('review:checkFreshness', payload)
  },

  // Spec Synthesizer
  synthesizeSpec: (args: import('../shared/types').SynthesizeRequest) =>
    typedInvoke('synthesizer:generate', args),
  reviseSpec: (args: import('../shared/types').ReviseRequest) =>
    typedInvoke('synthesizer:revise', args),
  cancelSynthesis: (streamId: string) => typedInvoke('synthesizer:cancel', streamId),
  onSynthesizerChunk: (
    cb: (data: {
      streamId: string
      chunk: string
      done: boolean
      fullText?: string
      filesAnalyzed?: string[]
      error?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _e: unknown,
      data: {
        streamId: string
        chunk: string
        done: boolean
        fullText?: string
        filesAnalyzed?: string[]
        error?: string
      }
    ): void => cb(data)
    ipcRenderer.on('synthesizer:chunk', listener)
    return () => ipcRenderer.removeListener('synthesizer:chunk', listener)
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
