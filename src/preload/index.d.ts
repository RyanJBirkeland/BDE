import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getGatewayConfig: () => Promise<{ url: string; token: string }>
      getGitHubToken: () => Promise<string | null>
      saveGatewayConfig: (url: string, token: string) => Promise<void>
      getRepoPaths: () => Promise<Record<string, string>>
      readSprintMd: (repoPath: string) => Promise<string>
      openExternal: (url: string) => Promise<void>
      listMemoryFiles: () => Promise<
        { path: string; name: string; size: number; modifiedAt: number }[]
      >
      readMemoryFile: (path: string) => Promise<string>
      writeMemoryFile: (path: string, content: string) => Promise<void>
      getDiff: (repoPath: string, base?: string) => Promise<string>
      getBranch: (repoPath: string) => Promise<string>
      getLog: (repoPath: string, n?: number) => Promise<string>
      setTitle: (title: string) => void

      // Git client
      gitStatus: (
        cwd: string
      ) => Promise<{ files: { path: string; status: string; staged: boolean }[] }>
      gitDiff: (cwd: string, file?: string) => Promise<string>
      gitStage: (cwd: string, files: string[]) => Promise<void>
      gitUnstage: (cwd: string, files: string[]) => Promise<void>
      gitCommit: (cwd: string, message: string) => Promise<void>
      gitPush: (cwd: string) => Promise<string>
      gitBranches: (cwd: string) => Promise<{ current: string; branches: string[] }>
      gitCheckout: (cwd: string, branch: string) => Promise<void>

      // Gateway tool invocation — proxied through main to avoid CORS
      invokeTool: (tool: string, args?: Record<string, unknown>) => Promise<unknown>
    }
  }
}
