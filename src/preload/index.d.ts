import { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentMeta, PrListPayload, SpawnLocalAgentArgs, SpawnLocalAgentResult, SprintTask } from '../shared/types'
import type { IpcChannelMap, GitHubFetchInit } from '../shared/ipc-channels'
import type { AgentEvent } from '../shared/types'

export type { AgentMeta, SpawnLocalAgentArgs, SpawnLocalAgentResult, SprintTask }

/** Helper — extracts the result type for a typed IPC channel. */
type IpcResult<K extends keyof IpcChannelMap> = IpcChannelMap[K]['result']
/** Helper — extracts the args tuple for a typed IPC channel. */
type IpcArgs<K extends keyof IpcChannelMap> = IpcChannelMap[K]['args']

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getRepoPaths: () => Promise<IpcResult<'git:getRepoPaths'>>
      openExternal: (...args: IpcArgs<'window:openExternal'>) => Promise<IpcResult<'window:openExternal'>>
      listMemoryFiles: () => Promise<IpcResult<'memory:listFiles'>>
      readMemoryFile: (...args: IpcArgs<'memory:readFile'>) => Promise<IpcResult<'memory:readFile'>>
      writeMemoryFile: (...args: IpcArgs<'memory:writeFile'>) => Promise<IpcResult<'memory:writeFile'>>
      setTitle: (title: string) => void

      // Settings CRUD
      settings: {
        get: (...args: IpcArgs<'settings:get'>) => Promise<IpcResult<'settings:get'>>
        set: (...args: IpcArgs<'settings:set'>) => Promise<IpcResult<'settings:set'>>
        getJson: (...args: IpcArgs<'settings:getJson'>) => Promise<IpcResult<'settings:getJson'>>
        setJson: (...args: IpcArgs<'settings:setJson'>) => Promise<IpcResult<'settings:setJson'>>
        delete: (...args: IpcArgs<'settings:delete'>) => Promise<IpcResult<'settings:delete'>>
      }

      // GitHub API proxy — all GitHub REST calls routed through main process
      github: {
        fetch: (path: string, init?: GitHubFetchInit) => Promise<IpcResult<'github:fetch'>>
      }

      // Agent runtime config
      getAgentConfig: () => Promise<IpcResult<'config:getAgentConfig'>>
      saveAgentConfig: (...args: IpcArgs<'config:saveAgentConfig'>) => Promise<IpcResult<'config:saveAgentConfig'>>

      // Local agent process detection + spawning
      getAgentProcesses: () => Promise<IpcResult<'local:getAgentProcesses'>>
      spawnLocalAgent: (...args: IpcArgs<'local:spawnClaudeAgent'>) => Promise<IpcResult<'local:spawnClaudeAgent'>>
      sendToAgent: (pid: number, message: string) => Promise<IpcResult<'local:sendToAgent'>>
      isAgentInteractive: (...args: IpcArgs<'local:isInteractive'>) => Promise<IpcResult<'local:isInteractive'>>
      steerAgent: (agentId: string, message: string) => Promise<IpcResult<'agent:steer'>>
      killLocalAgent: (...args: IpcArgs<'agent:killLocal'>) => Promise<IpcResult<'agent:killLocal'>>
      killAgent: (...args: IpcArgs<'agent:kill'>) => Promise<IpcResult<'agent:kill'>>
      tailAgentLog: (...args: IpcArgs<'local:tailAgentLog'>) => Promise<IpcResult<'local:tailAgentLog'>>

      // Agent event streaming (Phase 2)
      agentEvents: {
        onEvent: (callback: (payload: { agentId: string; event: AgentEvent }) => void) => () => void
        getHistory: (agentId: string) => Promise<AgentEvent[]>
      }

      // Template CRUD (Phase 2)
      templates: {
        list: () => Promise<IpcResult<'templates:list'>>
        save: (...args: IpcArgs<'templates:save'>) => Promise<IpcResult<'templates:save'>>
        delete: (...args: IpcArgs<'templates:delete'>) => Promise<IpcResult<'templates:delete'>>
        reset: (...args: IpcArgs<'templates:reset'>) => Promise<IpcResult<'templates:reset'>>
      }

      // Git client
      gitStatus: (...args: IpcArgs<'git:status'>) => Promise<IpcResult<'git:status'>>
      gitDiff: (...args: IpcArgs<'git:diff'>) => Promise<IpcResult<'git:diff'>>
      gitStage: (...args: IpcArgs<'git:stage'>) => Promise<IpcResult<'git:stage'>>
      gitUnstage: (...args: IpcArgs<'git:unstage'>) => Promise<IpcResult<'git:unstage'>>
      gitCommit: (...args: IpcArgs<'git:commit'>) => Promise<IpcResult<'git:commit'>>
      gitPush: (...args: IpcArgs<'git:push'>) => Promise<IpcResult<'git:push'>>
      gitBranches: (...args: IpcArgs<'git:branches'>) => Promise<IpcResult<'git:branches'>>
      gitCheckout: (...args: IpcArgs<'git:checkout'>) => Promise<IpcResult<'git:checkout'>>

      // Agent history — persistent audit trail
      agents: {
        list: (...args: IpcArgs<'agents:list'>) => Promise<IpcResult<'agents:list'>>
        readLog: (...args: IpcArgs<'agents:readLog'>) => Promise<IpcResult<'agents:readLog'>>
        import: (...args: IpcArgs<'agents:import'>) => Promise<IpcResult<'agents:import'>>
      }

      // Cost analytics
      cost: {
        summary: () => Promise<IpcResult<'cost:summary'>>
        agentRuns: (limit?: number) => Promise<IpcResult<'cost:agentRuns'>>
        getAgentHistory: (args?: { limit?: number; offset?: number }) => Promise<IpcResult<'cost:getAgentHistory'>>
      }

      // PR status polling
      pollPrStatuses: (...args: IpcArgs<'pr:pollStatuses'>) => Promise<IpcResult<'pr:pollStatuses'>>

      // Conflict file detection
      checkConflictFiles: (...args: IpcArgs<'pr:checkConflictFiles'>) => Promise<IpcResult<'pr:checkConflictFiles'>>

      // Sprint tasks — SQLite-backed Kanban
      sprint: {
        list: () => Promise<IpcResult<'sprint:list'>>
        create: (...args: IpcArgs<'sprint:create'>) => Promise<IpcResult<'sprint:create'>>
        update: (...args: IpcArgs<'sprint:update'>) => Promise<IpcResult<'sprint:update'>>
        readLog: (...args: IpcArgs<'sprint:readLog'>) => Promise<IpcResult<'sprint:readLog'>>
        readSpecFile: (...args: IpcArgs<'sprint:readSpecFile'>) => Promise<IpcResult<'sprint:readSpecFile'>>
        generatePrompt: (...args: IpcArgs<'sprint:generatePrompt'>) => Promise<IpcResult<'sprint:generatePrompt'>>
        delete: (...args: IpcArgs<'sprint:delete'>) => Promise<IpcResult<'sprint:delete'>>
        healthCheck: () => Promise<IpcResult<'sprint:healthCheck'>>
        claimTask: (taskId: string) => Promise<IpcResult<'sprint:claimTask'>>
        validateDependencies: (...args: IpcArgs<'sprint:validateDependencies'>) => Promise<IpcResult<'sprint:validateDependencies'>>
        unblockTask: (...args: IpcArgs<'sprint:unblockTask'>) => Promise<IpcResult<'sprint:unblockTask'>>
      }

      // File attachments
      openFileDialog: (...args: IpcArgs<'fs:openFileDialog'>) => Promise<IpcResult<'fs:openFileDialog'>>
      readFileAsBase64: (...args: IpcArgs<'fs:readFileAsBase64'>) => Promise<IpcResult<'fs:readFileAsBase64'>>
      readFileAsText: (...args: IpcArgs<'fs:readFileAsText'>) => Promise<IpcResult<'fs:readFileAsText'>>
      openDirectoryDialog: () => Promise<IpcResult<'fs:openDirectoryDialog'>>

      // GitHub rate-limit warning push events
      onGitHubRateLimitWarning: (
        cb: (data: { remaining: number; limit: number; resetEpoch: number }) => void
      ) => () => void

      // GitHub token expired push event
      onGitHubTokenExpired: (cb: () => void) => () => void

      // Open PR list — main-process poller push events
      onPrListUpdated: (cb: (payload: PrListPayload) => void) => () => void
      getPrList: () => Promise<IpcResult<'pr:getList'>>
      refreshPrList: () => Promise<IpcResult<'pr:refreshList'>>

      // Sprint DB file-watcher push events
      onExternalSprintChange: (cb: () => void) => () => void

      // Auth status
      authStatus: () => Promise<IpcResult<'auth:status'>>

      // Agent Manager
      agentManager: {
        status: () => Promise<IpcResult<'agent-manager:status'>>
        kill: (taskId: string) => Promise<IpcResult<'agent-manager:kill'>>
      }

      // Terminal PTY
      terminal: {
        create: (...args: IpcArgs<'terminal:create'>) => Promise<IpcResult<'terminal:create'>>
        write: (id: number, data: string) => void
        resize: (id: number, cols: number, rows: number) => Promise<IpcResult<'terminal:resize'>>
        kill: (...args: IpcArgs<'terminal:kill'>) => Promise<IpcResult<'terminal:kill'>>
        onData: (id: number, cb: (data: string) => void) => () => void
        onExit: (id: number, cb: () => void) => void
      }
    }
  }
}
