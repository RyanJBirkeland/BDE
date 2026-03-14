import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getGatewayConfig: () => Promise<{ url: string; token: string }>
      getGitHubToken: () => Promise<string | null>
      getRepoPaths: () => Promise<Record<string, string>>
      readSprintMd: (repoPath: string) => Promise<string>
      openExternal: (url: string) => Promise<void>,
      listMemoryFiles: () => Promise<
        { path: string; name: string; size: number; modifiedAt: number }[]
      >
      readMemoryFile: (path: string) => Promise<string>
      writeMemoryFile: (path: string, content: string) => Promise<void>
          getDiff: (repoPath: string, base?: string) => Promise<string>,
      openExternal: (url: string) => Promise<void>
      getDiff: (repoPath: string, base?: string) => Promise<string>
      getBranch: (repoPath: string) => Promise<string>
      getLog: (repoPath: string, n?: number) => Promise<string>
    }
  }
}
