import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { settings, claudeConfig } from './api-settings'
import {
  getRepoPaths,
  gitStatus,
  gitDiff,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitBranches,
  gitCheckout,
  gitDetectRemote,
  gitFetch,
  gitPull
} from './api-git'
import { sprint, groups } from './api-sprint'
import {
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
  searchMemory,
  getActiveMemoryFiles,
  setMemoryFileActive
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
  readFile,
  writeFile,
  watchDir,
  unwatchDir,
  createFile,
  createDir,
  rename,
  deletePath,
  stat,
  listFiles,
  onDirChanged,
  onGitHubError,
  onPrListUpdated,
  getPrList,
  refreshPrList,
  onExternalSprintChange,
  authStatus,
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
  // Clipboard + window
  readClipboardImage,
  openExternal,
  openPlaygroundInBrowser,
  setTitle,

  // Settings
  settings,
  claudeConfig,

  // Webhooks
  webhooks,

  // GitHub
  github,

  // Git client
  getRepoPaths,
  gitStatus,
  gitDiff,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitBranches,
  gitCheckout,
  gitDetectRemote,
  gitFetch,
  gitPull,

  // Memory
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
  searchMemory,
  getActiveMemoryFiles,
  setMemoryFileActive,

  // Agent processes
  getAgentProcesses,
  spawnLocalAgent,
  steerAgent,
  killAgent,
  getLatestCacheTokens,
  tailAgentLog,
  agents,
  agentManager,
  agentEvents,

  // Cost analytics
  cost,

  // PR
  pollPrStatuses,
  checkConflictFiles,
  onPrListUpdated,
  getPrList,
  refreshPrList,
  onGitHubError,

  // Sprint + groups
  sprint,
  groups,

  // Planner
  planner,

  // File system
  openFileDialog,
  readFileAsBase64,
  readFileAsText,
  openDirectoryDialog,
  readDir,
  readFile,
  writeFile,
  watchDir,
  unwatchDir,
  createFile,
  createDir,
  rename,
  deletePath,
  stat,
  listFiles,
  onDirChanged,

  // Sprint DB broadcast
  onExternalSprintChange,

  // Auth
  authStatus,

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

  // Spec Synthesizer
  synthesizeSpec,
  reviseSpec,
  cancelSynthesis,
  onSynthesizerChunk,

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
