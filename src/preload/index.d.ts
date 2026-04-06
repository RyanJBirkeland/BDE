import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AgentMeta,
  PrListPayload,
  SpawnLocalAgentArgs,
  SpawnLocalAgentResult,
  SprintTask,
  MetricsSnapshot
} from '../shared/types'
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
      openExternal: (
        ...args: IpcArgs<'window:openExternal'>
      ) => Promise<IpcResult<'window:openExternal'>>
      openPlaygroundInBrowser: (
        ...args: IpcArgs<'playground:openInBrowser'>
      ) => Promise<IpcResult<'playground:openInBrowser'>>
      listMemoryFiles: () => Promise<IpcResult<'memory:listFiles'>>
      readMemoryFile: (...args: IpcArgs<'memory:readFile'>) => Promise<IpcResult<'memory:readFile'>>
      writeMemoryFile: (
        ...args: IpcArgs<'memory:writeFile'>
      ) => Promise<IpcResult<'memory:writeFile'>>
      searchMemory: (...args: IpcArgs<'memory:search'>) => Promise<IpcResult<'memory:search'>>
      getActiveMemoryFiles: () => Promise<IpcResult<'memory:getActiveFiles'>>
      setMemoryFileActive: (
        ...args: IpcArgs<'memory:setFileActive'>
      ) => Promise<IpcResult<'memory:setFileActive'>>
      setTitle: (title: string) => void

      // Settings CRUD
      settings: {
        get: (...args: IpcArgs<'settings:get'>) => Promise<IpcResult<'settings:get'>>
        set: (...args: IpcArgs<'settings:set'>) => Promise<IpcResult<'settings:set'>>
        getJson: (...args: IpcArgs<'settings:getJson'>) => Promise<IpcResult<'settings:getJson'>>
        setJson: (...args: IpcArgs<'settings:setJson'>) => Promise<IpcResult<'settings:setJson'>>
        delete: (...args: IpcArgs<'settings:delete'>) => Promise<IpcResult<'settings:delete'>>
        saveProfile: (
          ...args: IpcArgs<'settings:saveProfile'>
        ) => Promise<IpcResult<'settings:saveProfile'>>
        loadProfile: (
          ...args: IpcArgs<'settings:loadProfile'>
        ) => Promise<IpcResult<'settings:loadProfile'>>
        applyProfile: (
          ...args: IpcArgs<'settings:applyProfile'>
        ) => Promise<IpcResult<'settings:applyProfile'>>
        listProfiles: () => Promise<IpcResult<'settings:listProfiles'>>
        deleteProfile: (
          ...args: IpcArgs<'settings:deleteProfile'>
        ) => Promise<IpcResult<'settings:deleteProfile'>>
      }

      // Claude CLI config (~/.claude/settings.json)
      claudeConfig: {
        get: () => Promise<IpcResult<'claude:getConfig'>>
        setPermissions: (permissions: {
          allow: string[]
          deny: string[]
        }) => Promise<IpcResult<'claude:setPermissions'>>
      }

      // Webhook management
      webhooks: {
        list: () => Promise<IpcResult<'webhook:list'>>
        create: (payload: {
          url: string
          events: string[]
          secret?: string
        }) => Promise<IpcResult<'webhook:create'>>
        update: (payload: {
          id: string
          url?: string
          events?: string[]
          secret?: string | null
          enabled?: boolean
        }) => Promise<IpcResult<'webhook:update'>>
        delete: (payload: { id: string }) => Promise<IpcResult<'webhook:delete'>>
        test: (payload: { id: string }) => Promise<IpcResult<'webhook:test'>>
      }

      // GitHub API proxy — all GitHub REST calls routed through main process
      github: {
        fetch: (path: string, init?: GitHubFetchInit) => Promise<IpcResult<'github:fetch'>>
      }

      // Local agent process detection + spawning
      getAgentProcesses: () => Promise<IpcResult<'local:getAgentProcesses'>>
      spawnLocalAgent: (
        ...args: IpcArgs<'local:spawnClaudeAgent'>
      ) => Promise<IpcResult<'local:spawnClaudeAgent'>>
      steerAgent: (agentId: string, message: string) => Promise<IpcResult<'agent:steer'>>
      killAgent: (...args: IpcArgs<'agent:kill'>) => Promise<IpcResult<'agent:kill'>>
      tailAgentLog: (
        ...args: IpcArgs<'local:tailAgentLog'>
      ) => Promise<IpcResult<'local:tailAgentLog'>>

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
        getAgentHistory: (args?: {
          limit?: number
          offset?: number
        }) => Promise<IpcResult<'cost:getAgentHistory'>>
      }

      // PR status polling
      pollPrStatuses: (...args: IpcArgs<'pr:pollStatuses'>) => Promise<IpcResult<'pr:pollStatuses'>>

      // Conflict file detection
      checkConflictFiles: (
        ...args: IpcArgs<'pr:checkConflictFiles'>
      ) => Promise<IpcResult<'pr:checkConflictFiles'>>

      // Sprint tasks — SQLite-backed Kanban
      sprint: {
        list: () => Promise<IpcResult<'sprint:list'>>
        create: (...args: IpcArgs<'sprint:create'>) => Promise<IpcResult<'sprint:create'>>
        createWorkflow: (
          ...args: IpcArgs<'sprint:createWorkflow'>
        ) => Promise<IpcResult<'sprint:createWorkflow'>>
        update: (...args: IpcArgs<'sprint:update'>) => Promise<IpcResult<'sprint:update'>>
        readLog: (...args: IpcArgs<'sprint:readLog'>) => Promise<IpcResult<'sprint:readLog'>>
        readSpecFile: (
          ...args: IpcArgs<'sprint:readSpecFile'>
        ) => Promise<IpcResult<'sprint:readSpecFile'>>
        generatePrompt: (
          ...args: IpcArgs<'sprint:generatePrompt'>
        ) => Promise<IpcResult<'sprint:generatePrompt'>>
        delete: (...args: IpcArgs<'sprint:delete'>) => Promise<IpcResult<'sprint:delete'>>
        healthCheck: () => Promise<IpcResult<'sprint:healthCheck'>>
        claimTask: (taskId: string) => Promise<IpcResult<'sprint:claimTask'>>
        validateDependencies: (
          ...args: IpcArgs<'sprint:validateDependencies'>
        ) => Promise<IpcResult<'sprint:validateDependencies'>>
        unblockTask: (
          ...args: IpcArgs<'sprint:unblockTask'>
        ) => Promise<IpcResult<'sprint:unblockTask'>>
        retry: (taskId: string) => Promise<IpcResult<'sprint:retry'>>
        batchUpdate: (
          ...args: IpcArgs<'sprint:batchUpdate'>
        ) => Promise<IpcResult<'sprint:batchUpdate'>>
        batchImport: (
          ...args: IpcArgs<'sprint:batchImport'>
        ) => Promise<IpcResult<'sprint:batchImport'>>
        exportTasks: (
          ...args: IpcArgs<'sprint:exportTasks'>
        ) => Promise<IpcResult<'sprint:exportTasks'>>
        exportTaskHistory: (taskId: string) => Promise<IpcResult<'sprint:exportTaskHistory'>>
        failureBreakdown: () => Promise<IpcResult<'sprint:failureBreakdown'>>
        getSuccessRateBySpecType: () => Promise<IpcResult<'sprint:getSuccessRateBySpecType'>>
      }

      // Task groups
      groups: {
        create: (...args: IpcArgs<'groups:create'>) => Promise<IpcResult<'groups:create'>>
        list: () => Promise<IpcResult<'groups:list'>>
        get: (...args: IpcArgs<'groups:get'>) => Promise<IpcResult<'groups:get'>>
        update: (...args: IpcArgs<'groups:update'>) => Promise<IpcResult<'groups:update'>>
        delete: (...args: IpcArgs<'groups:delete'>) => Promise<IpcResult<'groups:delete'>>
        addTask: (...args: IpcArgs<'groups:addTask'>) => Promise<IpcResult<'groups:addTask'>>
        removeTask: (
          ...args: IpcArgs<'groups:removeTask'>
        ) => Promise<IpcResult<'groups:removeTask'>>
        getGroupTasks: (
          ...args: IpcArgs<'groups:getGroupTasks'>
        ) => Promise<IpcResult<'groups:getGroupTasks'>>
        queueAll: (...args: IpcArgs<'groups:queueAll'>) => Promise<IpcResult<'groups:queueAll'>>
        reorderTasks: (
          ...args: IpcArgs<'groups:reorderTasks'>
        ) => Promise<IpcResult<'groups:reorderTasks'>>
      }

      // Plan import
      planner: {
        import: (...args: IpcArgs<'planner:import'>) => Promise<IpcResult<'planner:import'>>
      }

      // File attachments
      openFileDialog: (
        ...args: IpcArgs<'fs:openFileDialog'>
      ) => Promise<IpcResult<'fs:openFileDialog'>>
      readFileAsBase64: (
        ...args: IpcArgs<'fs:readFileAsBase64'>
      ) => Promise<IpcResult<'fs:readFileAsBase64'>>
      readFileAsText: (
        ...args: IpcArgs<'fs:readFileAsText'>
      ) => Promise<IpcResult<'fs:readFileAsText'>>
      openDirectoryDialog: () => Promise<IpcResult<'fs:openDirectoryDialog'>>
      readDir: (...args: IpcArgs<'fs:readDir'>) => Promise<IpcResult<'fs:readDir'>>
      readFile: (...args: IpcArgs<'fs:readFile'>) => Promise<IpcResult<'fs:readFile'>>
      writeFile: (...args: IpcArgs<'fs:writeFile'>) => Promise<IpcResult<'fs:writeFile'>>
      watchDir: (...args: IpcArgs<'fs:watchDir'>) => Promise<IpcResult<'fs:watchDir'>>
      unwatchDir: () => Promise<IpcResult<'fs:unwatchDir'>>
      createFile: (...args: IpcArgs<'fs:createFile'>) => Promise<IpcResult<'fs:createFile'>>
      createDir: (...args: IpcArgs<'fs:createDir'>) => Promise<IpcResult<'fs:createDir'>>
      rename: (...args: IpcArgs<'fs:rename'>) => Promise<IpcResult<'fs:rename'>>
      deletePath: (...args: IpcArgs<'fs:delete'>) => Promise<IpcResult<'fs:delete'>>
      stat: (...args: IpcArgs<'fs:stat'>) => Promise<IpcResult<'fs:stat'>>
      listFiles: (...args: IpcArgs<'fs:listFiles'>) => Promise<IpcResult<'fs:listFiles'>>
      onDirChanged: (callback: (dirPath: string) => void) => () => void

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
        getMetrics: () => Promise<MetricsSnapshot | null>
      }

      // Dashboard analytics
      dashboard: {
        completionsPerHour: () => Promise<IpcResult<'agent:completionsPerHour'>>
        recentEvents: (limit?: number) => Promise<IpcResult<'agent:recentEvents'>>
        dailySuccessRate: (days?: number) => Promise<IpcResult<'dashboard:dailySuccessRate'>>
        burndown: () => Promise<IpcResult<'sprint:burndown'>>
      }

      // Task Workbench
      workbench: {
        chat: (...args: IpcArgs<'workbench:chat'>) => Promise<IpcResult<'workbench:chat'>>
        chatStream: (
          ...args: IpcArgs<'workbench:chatStream'>
        ) => Promise<IpcResult<'workbench:chatStream'>>
        cancelStream: (
          ...args: IpcArgs<'workbench:cancelStream'>
        ) => Promise<IpcResult<'workbench:cancelStream'>>
        onChatChunk: (
          cb: (data: {
            streamId: string
            chunk: string
            done: boolean
            fullText?: string
            error?: string
          }) => void
        ) => () => void
        generateSpec: (
          ...args: IpcArgs<'workbench:generateSpec'>
        ) => Promise<IpcResult<'workbench:generateSpec'>>
        checkSpec: (
          ...args: IpcArgs<'workbench:checkSpec'>
        ) => Promise<IpcResult<'workbench:checkSpec'>>
        checkOperational: (
          ...args: IpcArgs<'workbench:checkOperational'>
        ) => Promise<IpcResult<'workbench:checkOperational'>>
        researchRepo: (
          ...args: IpcArgs<'workbench:researchRepo'>
        ) => Promise<IpcResult<'workbench:researchRepo'>>
        extractPlan: (
          ...args: IpcArgs<'workbench:extractPlan'>
        ) => Promise<IpcResult<'workbench:extractPlan'>>
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

      // Tear-off window management
      tearoff: {
        create: (payload: {
          view: string
          screenX: number
          screenY: number
          sourcePanelId: string
          sourceTabIndex: number
        }) => Promise<{ windowId: string }>
        closeConfirmed: (payload: {
          action: 'return' | 'close'
          remember: boolean
        }) => Promise<void>
        returnToMain: (windowId: string) => void
        onTabRemoved: (
          cb: (payload: { sourcePanelId: string; sourceTabIndex: number }) => void
        ) => () => void
        onTabReturned: (cb: (payload: { view: string }) => void) => () => void
        onConfirmClose: (cb: () => void) => () => void
        // Cross-window drag
        startCrossWindowDrag: (payload: {
          windowId: string
          viewKey: string
        }) => Promise<{ targetFound: boolean }>
        onDragIn: (
          cb: (payload: { viewKey: string; localX: number; localY: number }) => void
        ) => () => void
        onDragMove: (cb: (payload: { localX: number; localY: number }) => void) => () => void
        onDragCancel: (cb: () => void) => () => void
        sendDropComplete: (payload: {
          viewKey: string
          targetPanelId: string
          zone: string
        }) => void
        onCrossWindowDrop: (
          cb: (payload: { view: string; targetPanelId: string; zone: string }) => void
        ) => () => void
        onDragDone: (cb: () => void) => () => void
        sendDragCancel: () => void
        returnAll: (payload: { windowId: string; views: string[] }) => void
        viewsChanged: (payload: { windowId: string; views: string[] }) => void
      }

      // Code Review
      review: {
        getDiff: (payload: {
          worktreePath: string
          base: string
        }) => Promise<IpcResult<'review:getDiff'>>
        getCommits: (payload: {
          worktreePath: string
          base: string
        }) => Promise<IpcResult<'review:getCommits'>>
        getFileDiff: (payload: {
          worktreePath: string
          filePath: string
          base: string
        }) => Promise<IpcResult<'review:getFileDiff'>>
        mergeLocally: (payload: {
          taskId: string
          strategy: 'squash' | 'merge' | 'rebase'
        }) => Promise<IpcResult<'review:mergeLocally'>>
        createPr: (payload: {
          taskId: string
          title: string
          body: string
        }) => Promise<IpcResult<'review:createPr'>>
        requestRevision: (payload: {
          taskId: string
          feedback: string
          mode: 'resume' | 'fresh'
        }) => Promise<IpcResult<'review:requestRevision'>>
        discard: (payload: { taskId: string }) => Promise<IpcResult<'review:discard'>>
        shipIt: (payload: {
          taskId: string
          strategy: 'squash' | 'merge' | 'rebase'
        }) => Promise<IpcResult<'review:shipIt'>>
        rebase: (payload: { taskId: string }) => Promise<IpcResult<'review:rebase'>>
        checkFreshness: (payload: { taskId: string }) => Promise<IpcResult<'review:checkFreshness'>>
      }

      // Spec Synthesizer
      synthesizeSpec: (
        ...args: IpcArgs<'synthesizer:generate'>
      ) => Promise<IpcResult<'synthesizer:generate'>>
      reviseSpec: (
        ...args: IpcArgs<'synthesizer:revise'>
      ) => Promise<IpcResult<'synthesizer:revise'>>
      cancelSynthesis: (
        ...args: IpcArgs<'synthesizer:cancel'>
      ) => Promise<IpcResult<'synthesizer:cancel'>>
      onSynthesizerChunk: (
        cb: (data: {
          streamId: string
          chunk: string
          done: boolean
          fullText?: string
          filesAnalyzed?: string[]
          error?: string
        }) => void
      ) => () => void
    }
  }
}
