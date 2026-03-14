import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getGatewayConfig: (): Promise<{ url: string; token: string }> =>
    ipcRenderer.invoke('get-gateway-config'),
  getGitHubToken: (): Promise<string | null> => ipcRenderer.invoke('get-github-token'),
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
  setTitle: (title: string): void => ipcRenderer.send('set-title', title)
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
