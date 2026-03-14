import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getGatewayConfig: (): Promise<{ url: string; token: string }> =>
    ipcRenderer.invoke('get-gateway-config'),
  getGitHubToken: (): Promise<string | null> => ipcRenderer.invoke('get-github-token'),
  saveGatewayConfig: (url: string, token: string): Promise<void> =>
    ipcRenderer.invoke('save-gateway-config', url, token),
  getRepoPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-repo-paths'),
  readSprintMd: (repoPath: string): Promise<string> =>
    ipcRenderer.invoke('read-sprint-md', repoPath),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  listMemoryFiles: (): Promise<
    { path: string; name: string; size: number; modifiedAt: number }[]
  > => ipcRenderer.invoke('list-memory-files'),
  readMemoryFile: (path: string): Promise<string> =>
    ipcRenderer.invoke('read-memory-file', path),
  writeMemoryFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-memory-file', path, content),
  getDiff: (repoPath: string, base?: string): Promise<string> =>
    ipcRenderer.invoke('get-diff', repoPath, base),
  getBranch: (repoPath: string): Promise<string> => ipcRenderer.invoke('get-branch', repoPath),
  getLog: (repoPath: string, n?: number): Promise<string> =>
    ipcRenderer.invoke('get-log', repoPath, n),
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

  // Gateway tool invocation — proxied through main process to avoid CORS
  invokeTool: (tool: string, args?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('gateway:invoke', tool, args ?? {})
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
