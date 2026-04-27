import type {
  AgentMeta,
  PrListPayload,
  SpawnLocalAgentArgs,
  SpawnLocalAgentResult,
  SprintTask,
  MetricsSnapshot
} from '../shared/types'
import type {
  IpcChannelMap,
  GitHubFetchInit,
  LocalRepoInfo,
  GithubRepoInfo,
  CloneProgressEvent
} from '../shared/ipc-channels'
import type { ReviewResult, PartnerMessage, ChatChunk } from '../shared/types'
import type { AgentEvent } from '../shared/types'
import type { AgentManagerDrainPausedEvent } from '../shared/ipc-channels/broadcast-channels'

export type { AgentMeta, SpawnLocalAgentArgs, SpawnLocalAgentResult, SprintTask }
export type { AgentManagerDrainPausedEvent }

/** Helper — extracts the result type for a typed IPC channel. */
type IpcResult<K extends keyof IpcChannelMap> = IpcChannelMap[K]['result']
/** Helper — extracts the args tuple for a typed IPC channel. */
type IpcArgs<K extends keyof IpcChannelMap> = IpcChannelMap[K]['args']

declare global {
  interface Window {
    api: {
      // Settings CRUD
      settings: {
        get: (...args: IpcArgs<'settings:get'>) => Promise<IpcResult<'settings:get'>>
        set: (...args: IpcArgs<'settings:set'>) => Promise<IpcResult<'settings:set'>>
        getJson: (...args: IpcArgs<'settings:getJson'>) => Promise<IpcResult<'settings:getJson'>>
        setJson: (...args: IpcArgs<'settings:setJson'>) => Promise<IpcResult<'settings:setJson'>>
        delete: (...args: IpcArgs<'settings:delete'>) => Promise<IpcResult<'settings:delete'>>
        hasSecret: (
          ...args: IpcArgs<'settings:hasSecret'>
        ) => Promise<IpcResult<'settings:hasSecret'>>
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
        getEncryptionStatus: () => Promise<IpcResult<'settings:getEncryptionStatus'>>
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
        isConfigured: () => Promise<IpcResult<'github:isConfigured'>>
      }

      // Git client
      git: {
        checkInstalled: () => Promise<IpcResult<'git:checkInstalled'>>
        getRepoPaths: () => Promise<IpcResult<'git:getRepoPaths'>>
        status: (...args: IpcArgs<'git:status'>) => Promise<IpcResult<'git:status'>>
        diff: (...args: IpcArgs<'git:diff'>) => Promise<IpcResult<'git:diff'>>
        stage: (...args: IpcArgs<'git:stage'>) => Promise<IpcResult<'git:stage'>>
        unstage: (...args: IpcArgs<'git:unstage'>) => Promise<IpcResult<'git:unstage'>>
        commit: (...args: IpcArgs<'git:commit'>) => Promise<IpcResult<'git:commit'>>
        push: (...args: IpcArgs<'git:push'>) => Promise<IpcResult<'git:push'>>
        branches: (...args: IpcArgs<'git:branches'>) => Promise<IpcResult<'git:branches'>>
        checkout: (...args: IpcArgs<'git:checkout'>) => Promise<IpcResult<'git:checkout'>>
        detectRemote: (
          ...args: IpcArgs<'git:detectRemote'>
        ) => Promise<IpcResult<'git:detectRemote'>>
        fetch: (...args: IpcArgs<'git:fetch'>) => Promise<IpcResult<'git:fetch'>>
        pull: (...args: IpcArgs<'git:pull'>) => Promise<IpcResult<'git:pull'>>
      }

      // Memory
      memory: {
        listFiles: () => Promise<IpcResult<'memory:listFiles'>>
        readFile: (...args: IpcArgs<'memory:readFile'>) => Promise<IpcResult<'memory:readFile'>>
        writeFile: (...args: IpcArgs<'memory:writeFile'>) => Promise<IpcResult<'memory:writeFile'>>
        search: (...args: IpcArgs<'memory:search'>) => Promise<IpcResult<'memory:search'>>
        getActiveFiles: () => Promise<IpcResult<'memory:getActiveFiles'>>
        setFileActive: (
          ...args: IpcArgs<'memory:setFileActive'>
        ) => Promise<IpcResult<'memory:setFileActive'>>
      }

      // File system
      fs: {
        openFileDialog: (
          ...args: IpcArgs<'fs:openFileDialog'>
        ) => Promise<IpcResult<'fs:openFileDialog'>>
        readAsBase64: (
          ...args: IpcArgs<'fs:readFileAsBase64'>
        ) => Promise<IpcResult<'fs:readFileAsBase64'>>
        readAsText: (
          ...args: IpcArgs<'fs:readFileAsText'>
        ) => Promise<IpcResult<'fs:readFileAsText'>>
        openDirDialog: () => Promise<IpcResult<'fs:openDirectoryDialog'>>
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
      }

      // PR lifecycle
      pr: {
        pollStatuses: (...args: IpcArgs<'pr:pollStatuses'>) => Promise<IpcResult<'pr:pollStatuses'>>
        checkConflictFiles: (
          ...args: IpcArgs<'pr:checkConflictFiles'>
        ) => Promise<IpcResult<'pr:checkConflictFiles'>>
        onListUpdated: (cb: (payload: PrListPayload) => void) => () => void
        getList: () => Promise<IpcResult<'pr:getList'>>
        refreshList: () => Promise<IpcResult<'pr:refreshList'>>
        onGitHubError: (
          cb: (data: {
            kind:
              | 'no-token'
              | 'token-expired'
              | 'rate-limit'
              | 'billing'
              | 'permission'
              | 'not-found'
              | 'validation'
              | 'server'
              | 'network'
              | 'unknown'
            message: string
            status?: number
          }) => void
        ) => () => void
      }

      // Clipboard + window utilities
      window: {
        readClipboardImage: () => Promise<IpcResult<'clipboard:readImage'>>
        openExternal: (
          ...args: IpcArgs<'window:openExternal'>
        ) => Promise<IpcResult<'window:openExternal'>>
        openPlaygroundInBrowser: (
          ...args: IpcArgs<'playground:openInBrowser'>
        ) => Promise<IpcResult<'playground:openInBrowser'>>
        sanitizePlayground: (
          ...args: IpcArgs<'playground:sanitize'>
        ) => Promise<IpcResult<'playground:sanitize'>>
        setTitle: (title: string) => void
      }

      // Auth
      auth: {
        status: () => Promise<IpcResult<'auth:status'>>
      }

      // Onboarding
      onboarding: {
        checkGhCli: () => Promise<IpcResult<'onboarding:checkGhCli'>>
      }

      // Spec Synthesizer
      synthesizer: {
        generate: (
          ...args: IpcArgs<'synthesizer:generate'>
        ) => Promise<IpcResult<'synthesizer:generate'>>
        revise: (...args: IpcArgs<'synthesizer:revise'>) => Promise<IpcResult<'synthesizer:revise'>>
        cancel: (...args: IpcArgs<'synthesizer:cancel'>) => Promise<IpcResult<'synthesizer:cancel'>>
        onChunk: (
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
        forceFailTask: (
          ...args: IpcArgs<'sprint:forceFailTask'>
        ) => Promise<IpcResult<'sprint:forceFailTask'>>
        forceDoneTask: (
          ...args: IpcArgs<'sprint:forceDoneTask'>
        ) => Promise<IpcResult<'sprint:forceDoneTask'>>
        forceReleaseClaim: (
          ...args: IpcArgs<'sprint:forceReleaseClaim'>
        ) => Promise<IpcResult<'sprint:forceReleaseClaim'>>
        onExternalChange: (cb: () => void) => () => void
        onMutation: (
          cb: (payload: { type: 'created' | 'updated' | 'deleted'; task: SprintTask }) => void
        ) => () => void
        onTerminalError: (cb: (payload: { error: string }) => void) => () => void
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
        addDependency: (
          ...args: IpcArgs<'groups:addDependency'>
        ) => Promise<IpcResult<'groups:addDependency'>>
        removeDependency: (
          ...args: IpcArgs<'groups:removeDependency'>
        ) => Promise<IpcResult<'groups:removeDependency'>>
        updateDependencyCondition: (
          ...args: IpcArgs<'groups:updateDependencyCondition'>
        ) => Promise<IpcResult<'groups:updateDependencyCondition'>>
      }

      // Plan import
      planner: {
        import: (...args: IpcArgs<'planner:import'>) => Promise<IpcResult<'planner:import'>>
      }

      // Agent history + process management
      agents: {
        list: (...args: IpcArgs<'agents:list'>) => Promise<IpcResult<'agents:list'>>
        readLog: (...args: IpcArgs<'agents:readLog'>) => Promise<IpcResult<'agents:readLog'>>
        import: (...args: IpcArgs<'agents:import'>) => Promise<IpcResult<'agents:import'>>
        promoteToReview: (
          ...args: IpcArgs<'agents:promoteToReview'>
        ) => Promise<IpcResult<'agents:promoteToReview'>>
        testLocalEndpoint: (endpoint: string) => Promise<IpcResult<'agents:testLocalEndpoint'>>
        getProcesses: () => Promise<IpcResult<'local:getAgentProcesses'>>
        spawnLocal: (
          ...args: IpcArgs<'local:spawnClaudeAgent'>
        ) => Promise<IpcResult<'local:spawnClaudeAgent'>>
        steer: (
          agentId: string,
          message: string,
          images?: Array<{ data: string; mimeType: string }>
        ) => Promise<IpcResult<'agent:steer'>>
        kill: (...args: IpcArgs<'agent:kill'>) => Promise<IpcResult<'agent:kill'>>
        getContextTokens: (runId: string) => Promise<IpcResult<'agent:contextTokens'>>
        tailLog: (
          ...args: IpcArgs<'local:tailAgentLog'>
        ) => Promise<IpcResult<'local:tailAgentLog'>>
        events: {
          onEvent: (
            callback: (payload: { agentId: string; event: AgentEvent }) => void
          ) => () => void
          getHistory: (agentId: string) => Promise<AgentEvent[]>
        }
      }

      // Agent Manager
      agentManager: {
        status: () => Promise<IpcResult<'agent-manager:status'>>
        kill: (taskId: string) => Promise<IpcResult<'agent-manager:kill'>>
        getMetrics: () => Promise<MetricsSnapshot | null>
        reloadConfig: () => Promise<IpcResult<'agent-manager:reloadConfig'>>
        checkpoint: (
          taskId: string,
          message?: string
        ) => Promise<IpcResult<'agent-manager:checkpoint'>>
        onWarning: (cb: (payload: { message: string }) => void) => () => void
        onCircuitBreakerOpen: (
          cb: (payload: { consecutiveFailures: number; openUntil: number }) => void
        ) => () => void
        onDrainPaused: (cb: (event: AgentManagerDrainPausedEvent) => void) => () => void
        onOrphanRecovered: (cb: (payload: { recovered: string[]; exhausted: string[] }) => void) => () => void
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

      // Template CRUD
      templates: {
        list: () => Promise<IpcResult<'templates:list'>>
        save: (...args: IpcArgs<'templates:save'>) => Promise<IpcResult<'templates:save'>>
        delete: (...args: IpcArgs<'templates:delete'>) => Promise<IpcResult<'templates:delete'>>
        reset: (...args: IpcArgs<'templates:reset'>) => Promise<IpcResult<'templates:reset'>>
      }

      // Dashboard analytics
      dashboard: {
        completionsPerHour: () => Promise<IpcResult<'dashboard:completionsPerHour'>>
        recentEvents: (limit?: number) => Promise<IpcResult<'dashboard:recentEvents'>>
        dailySuccessRate: (days?: number) => Promise<IpcResult<'dashboard:dailySuccessRate'>>
      }

      // System metrics
      system: {
        loadAverage: () => Promise<IpcResult<'system:loadAverage'>>
      }

      // Task Workbench
      workbench: {
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
            toolUse?: { name: string; input: Record<string, unknown> }
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
        shipBatch: (payload: {
          taskIds: string[]
          strategy: 'squash' | 'merge' | 'rebase'
        }) => Promise<IpcResult<'review:shipBatch'>>
        rebase: (payload: { taskId: string }) => Promise<IpcResult<'review:rebase'>>
        checkFreshness: (payload: { taskId: string }) => Promise<IpcResult<'review:checkFreshness'>>
        checkAutoReview: (payload: {
          taskId: string
        }) => Promise<IpcResult<'review:checkAutoReview'>>
        markShippedOutsideBde: (payload: {
          taskId: string
        }) => Promise<IpcResult<'review:markShippedOutsideBde'>>
        // AI Review Partner
        autoReview: (taskId: string, force?: boolean) => Promise<ReviewResult>
        chatStream: (params: {
          taskId: string
          messages: PartnerMessage[]
        }) => Promise<{ streamId: string }>
        onChatChunk: (listener: (evt: unknown, chunk: ChatChunk) => void) => () => void
        abortChat: (streamId: string) => Promise<void>
      }

      // Repository discovery
      repoDiscovery: {
        scanLocal: (dirs: string[]) => Promise<LocalRepoInfo[]>
        listGithub: () => Promise<GithubRepoInfo[]>
        clone: (owner: string, repo: string, destDir: string) => Promise<void>
        onCloneProgress: (cb: (data: CloneProgressEvent) => void) => () => void
      }

      // MCP server management
      mcp: {
        getToken: () => Promise<string>
        regenerateToken: () => Promise<string>
      }
    }
  }
}
