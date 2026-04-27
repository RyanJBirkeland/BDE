import { ipcRenderer } from 'electron'
import { typedInvoke, onBroadcast } from './ipc-helpers'
import type { GitHubFetchInit, IpcChannelMap, TerminalDataPayload } from '../shared/ipc-channels'
import type { BroadcastChannels } from '../shared/ipc-channels/broadcast-channels'
import type {
  TaskTemplate,
  SynthesizeRequest,
  ReviseRequest,
  PartnerMessage
} from '../shared/types'

// Clipboard
export const readClipboardImage = (): Promise<IpcChannelMap['clipboard:readImage']['result']> =>
  typedInvoke('clipboard:readImage')

// Window
export const openExternal = (
  url: string
): Promise<IpcChannelMap['window:openExternal']['result']> =>
  typedInvoke('window:openExternal', url)
export const openPlaygroundInBrowser = (
  html: string
): Promise<IpcChannelMap['playground:openInBrowser']['result']> =>
  typedInvoke('playground:openInBrowser', html)
export const sanitizePlaygroundHtml = (
  html: string
): Promise<IpcChannelMap['playground:sanitize']['result']> =>
  typedInvoke('playground:sanitize', html)
export const setTitle = (title: string): void => ipcRenderer.send('window:setTitle', title)

// GitHub API proxy
export const github = {
  fetch: (path: string, init?: GitHubFetchInit) => typedInvoke('github:fetch', path, init),
  isConfigured: () => typedInvoke('github:isConfigured')
}

// Cost analytics
export const cost = {
  summary: () => typedInvoke('cost:summary'),
  agentRuns: (limit?: number) => typedInvoke('cost:agentRuns', { limit: limit ?? 20 }),
  getAgentHistory: (args?: { limit?: number; offset?: number }) =>
    typedInvoke('cost:getAgentHistory', args)
}

// PR status polling
export const pollPrStatuses = (
  prs: { taskId: string; prUrl: string }[]
): Promise<IpcChannelMap['pr:pollStatuses']['result']> => typedInvoke('pr:pollStatuses', prs)

// Conflict file detection
export const checkConflictFiles = (input: {
  owner: string
  repo: string
  prNumber: number
}): Promise<IpcChannelMap['pr:checkConflictFiles']['result']> =>
  typedInvoke('pr:checkConflictFiles', input)

// Plan import
export const planner = {
  import: (repo: string) => typedInvoke('planner:import', repo)
}

// File system
export const openFileDialog = (opts?: {
  filters?: { name: string; extensions: string[] }[]
}): Promise<IpcChannelMap['fs:openFileDialog']['result']> => typedInvoke('fs:openFileDialog', opts)
export const readFileAsBase64 = (
  path: string
): Promise<IpcChannelMap['fs:readFileAsBase64']['result']> =>
  typedInvoke('fs:readFileAsBase64', path)
export const readFileAsText = (
  path: string
): Promise<IpcChannelMap['fs:readFileAsText']['result']> => typedInvoke('fs:readFileAsText', path)
export const openDirectoryDialog = (): Promise<IpcChannelMap['fs:openDirectoryDialog']['result']> =>
  typedInvoke('fs:openDirectoryDialog')
export const readDir = (dirPath: string): Promise<IpcChannelMap['fs:readDir']['result']> =>
  typedInvoke('fs:readDir', dirPath)
export const readFile = (filePath: string): Promise<IpcChannelMap['fs:readFile']['result']> =>
  typedInvoke('fs:readFile', filePath)
export const writeFile = (
  filePath: string,
  content: string
): Promise<IpcChannelMap['fs:writeFile']['result']> =>
  typedInvoke('fs:writeFile', filePath, content)
export const watchDir = (dirPath: string): Promise<IpcChannelMap['fs:watchDir']['result']> =>
  typedInvoke('fs:watchDir', dirPath)
export const unwatchDir = (): Promise<IpcChannelMap['fs:unwatchDir']['result']> =>
  typedInvoke('fs:unwatchDir')
export const createFile = (filePath: string): Promise<IpcChannelMap['fs:createFile']['result']> =>
  typedInvoke('fs:createFile', filePath)
export const createDir = (dirPath: string): Promise<IpcChannelMap['fs:createDir']['result']> =>
  typedInvoke('fs:createDir', dirPath)
export const rename = (
  oldPath: string,
  newPath: string
): Promise<IpcChannelMap['fs:rename']['result']> => typedInvoke('fs:rename', oldPath, newPath)
export const deletePath = (targetPath: string): Promise<IpcChannelMap['fs:delete']['result']> =>
  typedInvoke('fs:delete', targetPath)
export const stat = (targetPath: string): Promise<IpcChannelMap['fs:stat']['result']> =>
  typedInvoke('fs:stat', targetPath)
export const listFiles = (rootPath: string): Promise<IpcChannelMap['fs:listFiles']['result']> =>
  typedInvoke('fs:listFiles', rootPath)
export const onDirChanged = onBroadcast<BroadcastChannels['fs:dirChanged']>('fs:dirChanged')

// GitHub error broadcast
export const onGitHubError = onBroadcast<BroadcastChannels['github:error']>('github:error')

// PR list broadcast
export const onPrListUpdated = onBroadcast<BroadcastChannels['pr:listUpdated']>('pr:listUpdated')
export const getPrList = (): Promise<IpcChannelMap['pr:getList']['result']> =>
  typedInvoke('pr:getList')
export const refreshPrList = (): Promise<IpcChannelMap['pr:refreshList']['result']> =>
  typedInvoke('pr:refreshList')

// Sprint DB file-watcher broadcast
export const onExternalSprintChange =
  onBroadcast<BroadcastChannels['sprint:externalChange']>('sprint:externalChange')

// Sprint task mutation broadcast (granular — carries the changed task payload)
export const onSprintMutation = onBroadcast<BroadcastChannels['sprint:mutation']>('sprint:mutation')

// Task terminal resolution error broadcast
export const onTaskTerminalError = onBroadcast<BroadcastChannels['task-terminal:resolution-error']>(
  'task-terminal:resolution-error'
)

// Auth status
export const authStatus = (): Promise<IpcChannelMap['auth:status']['result']> =>
  typedInvoke('auth:status')

// Onboarding checks
export const onboarding = {
  checkGhCli: (): Promise<IpcChannelMap['onboarding:checkGhCli']['result']> =>
    typedInvoke('onboarding:checkGhCli')
}

// Template CRUD
export const templates = {
  list: () => typedInvoke('templates:list'),
  save: (template: TaskTemplate) => typedInvoke('templates:save', template),
  delete: (name: string) => typedInvoke('templates:delete', name),
  reset: (name: string) => typedInvoke('templates:reset', name)
}

// Terminal PTY
export const terminal = {
  create: (opts: { cols: number; rows: number; shell?: string }) =>
    typedInvoke('terminal:create', opts),
  write: (id: number, data: string): void => ipcRenderer.send('terminal:write', { id, data }),
  resize: (id: number, cols: number, rows: number) =>
    typedInvoke('terminal:resize', { id, cols, rows }),
  kill: (id: number) => typedInvoke('terminal:kill', id),
  // Dynamic channels — `terminal:data:${id}` sends TerminalDataPayload (string),
  // `terminal:exit:${id}` sends no payload. See TerminalDataPayload in system-channels.ts.
  onData: (id: number, cb: (data: TerminalDataPayload['data']) => void): (() => void) => {
    const listener = (_: unknown, data: TerminalDataPayload['data']): void => cb(data)
    ipcRenderer.on('terminal:data:' + id, listener)
    return () => ipcRenderer.removeListener('terminal:data:' + id, listener)
  },
  onExit: (id: number, cb: () => void): void => {
    ipcRenderer.once('terminal:exit:' + id, cb)
  }
}

// Dashboard analytics
export const dashboard = {
  completionsPerHour: () => typedInvoke('dashboard:completionsPerHour'),
  recentEvents: (limit?: number) => typedInvoke('dashboard:recentEvents', limit),
  dailySuccessRate: (days?: number) => typedInvoke('dashboard:dailySuccessRate', days)
}

// System metrics
export const system = {
  loadAverage: () => typedInvoke('system:loadAverage')
}

// Task Workbench
export const workbench = {
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
  onChatChunk: onBroadcast<BroadcastChannels['workbench:chatChunk']>('workbench:chatChunk')
}

// Tear-off window management
export const tearoff = {
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
  onTabRemoved: onBroadcast<{ sourcePanelId: string; sourceTabIndex: number }>(
    'tearoff:tabRemoved'
  ),
  onTabReturned: onBroadcast<{ view: string }>('tearoff:tabReturned'),
  onConfirmClose: onBroadcast<undefined>('tearoff:confirmClose'),
  startCrossWindowDrag: (payload: { windowId: string; viewKey: string }) =>
    typedInvoke('tearoff:startCrossWindowDrag', payload),
  onDragIn: onBroadcast<{ viewKey: string; localX: number; localY: number }>('tearoff:dragIn'),
  onDragMove: onBroadcast<{ localX: number; localY: number }>('tearoff:dragMove'),
  onDragCancel: onBroadcast<undefined>('tearoff:dragCancel'),
  sendDropComplete: (payload: { viewKey: string; targetPanelId: string; zone: string }) =>
    ipcRenderer.send('tearoff:dropComplete', payload),
  onCrossWindowDrop: onBroadcast<{ view: string; targetPanelId: string; zone: string }>(
    'tearoff:crossWindowDrop'
  ),
  onDragDone: onBroadcast<undefined>('tearoff:dragDone'),
  sendDragCancel: () => ipcRenderer.send('tearoff:dragCancelFromRenderer'),
  returnAll: (payload: { windowId: string; views: string[] }) =>
    ipcRenderer.send('tearoff:returnAll', payload),
  viewsChanged: (payload: { windowId: string; views: string[] }) =>
    ipcRenderer.send('tearoff:viewsChanged', payload)
}

// Code Review
export const review = {
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
  shipBatch: (payload: { taskIds: string[]; strategy: 'squash' | 'merge' | 'rebase' }) =>
    typedInvoke('review:shipBatch', payload),
  checkAutoReview: (payload: { taskId: string }) => typedInvoke('review:checkAutoReview', payload),
  rebase: (payload: { taskId: string }) => typedInvoke('review:rebase', payload),
  checkFreshness: (payload: { taskId: string }) => typedInvoke('review:checkFreshness', payload),
  markShippedOutsideBde: (payload: { taskId: string }) =>
    typedInvoke('review:markShippedOutsideBde', payload),
  autoReview: (taskId: string, force?: boolean) =>
    typedInvoke('review:autoReview', taskId, force ?? false),
  chatStream: (params: { taskId: string; messages: PartnerMessage[] }) =>
    typedInvoke('review:chatStream', params),
  onChatChunk: onBroadcast<BroadcastChannels['review:chatChunk']>('review:chatChunk'),
  abortChat: (streamId: string) => typedInvoke('review:chatAbort', streamId)
}

// Spec Synthesizer
export const synthesizeSpec = (
  args: SynthesizeRequest
): Promise<IpcChannelMap['synthesizer:generate']['result']> =>
  typedInvoke('synthesizer:generate', args)
export const reviseSpec = (
  args: ReviseRequest
): Promise<IpcChannelMap['synthesizer:revise']['result']> => typedInvoke('synthesizer:revise', args)
export const cancelSynthesis = (
  streamId: string
): Promise<IpcChannelMap['synthesizer:cancel']['result']> =>
  typedInvoke('synthesizer:cancel', streamId)
export const onSynthesizerChunk =
  onBroadcast<BroadcastChannels['synthesizer:chunk']>('synthesizer:chunk')

// Repository discovery
export const repoDiscovery = {
  scanLocal: (dirs: string[]) => typedInvoke('repos:scanLocal', dirs),
  listGithub: () => typedInvoke('repos:listGithub'),
  clone: (owner: string, repo: string, destDir: string) =>
    typedInvoke('repos:clone', owner, repo, destDir),
  onCloneProgress: onBroadcast<BroadcastChannels['repos:cloneProgress']>('repos:cloneProgress')
}
