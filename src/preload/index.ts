import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { settings, claudeConfig } from './api-settings'
import {
  checkInstalled,
  getRepoPaths,
  gitStatus as status,
  gitDiff as diff,
  gitStage as stage,
  gitUnstage as unstage,
  gitCommit as commit,
  gitPush as push,
  gitBranches as branches,
  gitCheckout as checkout,
  gitDetectRemote as detectRemote,
  gitFetch as fetch,
  gitPull as pull
} from './api-git'
import { sprint, groups } from './api-sprint'
import {
  listMemoryFiles as listFiles,
  readMemoryFile as readFile,
  writeMemoryFile as writeFile,
  searchMemory as search,
  getActiveMemoryFiles as getActiveFiles,
  setMemoryFileActive as setFileActive
} from './api-memory'
import {
  getAgentProcesses,
  spawnLocalAgent,
  steerAgent,
  killAgent,
  getLatestCacheTokens,
  tailAgentLog,
  agents,
  agentManager,
  agentEvents
} from './api-agents'
import { webhooks } from './api-webhooks'
import {
  readClipboardImage,
  openExternal,
  openPlaygroundInBrowser,
  sanitizePlaygroundHtml,
  setTitle,
  github,
  cost,
  pollPrStatuses,
  checkConflictFiles,
  planner,
  openFileDialog,
  readFileAsBase64,
  readFileAsText,
  openDirectoryDialog,
  readDir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  watchDir,
  unwatchDir,
  createFile,
  createDir,
  rename,
  deletePath,
  stat,
  listFiles as fsListFiles,
  onDirChanged,
  onGitHubError,
  onPrListUpdated,
  getPrList,
  refreshPrList,
  onExternalSprintChange,
  onSprintMutation,
  onTaskTerminalError,
  authStatus,
  onboarding,
  templates,
  terminal,
  dashboard,
  system,
  workbench,
  tearoff,
  review,
  synthesizeSpec,
  reviseSpec,
  cancelSynthesis,
  onSynthesizerChunk,
  repoDiscovery
} from './api-utilities'

// Prevent MaxListenersExceededWarning during HMR dev cycles
ipcRenderer.setMaxListeners(25)

const api = {
  // Settings
  settings,
  claudeConfig,

  // Webhooks
  webhooks,

  // GitHub API proxy
  github,

  // Git client
  git: {
    checkInstalled,
    getRepoPaths,
    status,
    diff,
    stage,
    unstage,
    commit,
    push,
    branches,
    checkout,
    detectRemote,
    fetch,
    pull
  },

  // Memory
  memory: {
    listFiles,
    readFile,
    writeFile,
    search,
    getActiveFiles,
    setFileActive
  },

  // File system
  fs: {
    openFileDialog,
    readAsBase64: readFileAsBase64,
    readAsText: readFileAsText,
    openDirDialog: openDirectoryDialog,
    readDir,
    readFile: fsReadFile,
    writeFile: fsWriteFile,
    watchDir,
    unwatchDir,
    createFile,
    createDir,
    rename,
    deletePath,
    stat,
    listFiles: fsListFiles,
    onDirChanged
  },

  // PR lifecycle
  pr: {
    pollStatuses: pollPrStatuses,
    checkConflictFiles,
    onListUpdated: onPrListUpdated,
    getList: getPrList,
    refreshList: refreshPrList,
    onGitHubError
  },

  // Clipboard + window utilities
  window: {
    readClipboardImage,
    openExternal,
    openPlaygroundInBrowser,
    sanitizePlayground: sanitizePlaygroundHtml,
    setTitle
  },

  // Auth
  auth: {
    status: authStatus
  },

  // Onboarding
  onboarding,

  // Spec Synthesizer
  synthesizer: {
    generate: synthesizeSpec,
    revise: reviseSpec,
    cancel: cancelSynthesis,
    onChunk: onSynthesizerChunk
  },

  // Sprint + groups (sprint expanded with onExternalChange + onMutation)
  sprint: {
    ...sprint,
    onExternalChange: onExternalSprintChange,
    onMutation: onSprintMutation,
    onTerminalError: onTaskTerminalError
  },
  groups,

  // Planner
  planner,

  // Agent processes + history (expanded with flat ops + agentEvents)
  agents: {
    ...agents,
    getProcesses: getAgentProcesses,
    spawnLocal: spawnLocalAgent,
    steer: steerAgent,
    kill: killAgent,
    getLatestCacheTokens,
    tailLog: tailAgentLog,
    events: agentEvents
  },
  agentManager,

  // Cost analytics
  cost,

  // Templates
  templates,

  // Terminal
  terminal,

  // Dashboard
  dashboard,

  // System
  system,

  // Workbench
  workbench,

  // Tear-off
  tearoff,

  // Code Review
  review,

  // Repository discovery
  repoDiscovery
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
