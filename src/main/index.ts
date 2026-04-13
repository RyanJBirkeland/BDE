import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  startDbWatcher,
  initializeDatabase,
  startBackgroundServices,
  startPrPollers,
  setupCleanupTasks,
  setupCSP
} from './bootstrap'
import icon from '../../resources/icon.png?asset'
import { registerAgentHandlers } from './handlers/agent-handlers'
import { registerGitHandlers } from './handlers/git-handlers'
import { registerTerminalHandlers } from './handlers/terminal-handlers'
import { registerConfigHandlers } from './handlers/config-handlers'
import { registerWindowHandlers } from './handlers/window-handlers'
import { registerSprintLocalHandlers } from './handlers/sprint-local'
import { registerCostHandlers } from './handlers/cost-handlers'
import { registerFsHandlers } from './fs'
import { registerTemplateHandlers } from './handlers/template-handlers'
import { registerAuthHandlers } from './handlers/auth-handlers'
import { registerAgentManagerHandlers } from './handlers/agent-manager-handlers'
import { registerWorkbenchHandlers } from './handlers/workbench'
import { registerMemorySearchHandler } from './handlers/memory-search'
import { registerIdeFsHandlers } from './handlers/ide-fs-handlers'
import { registerDashboardHandlers } from './handlers/dashboard-handlers'
import { registerSynthesizerHandlers } from './handlers/synthesizer-handlers'
import { registerClaudeConfigHandlers } from './handlers/claude-config-handlers'
import { registerReviewHandlers } from './handlers/review'
import { registerReviewAssistantHandlers, buildChatStreamDeps } from './handlers/review-assistant'
import { createReviewRepository } from './data/review-repository'
import { createReviewService } from './services/review-service'
import { runSdkOnce } from './sdk-streaming'
import { getDb } from './db'
import { registerWebhookHandlers } from './handlers/webhook-handlers'
import { registerGroupHandlers } from './handlers/group-handlers'
import { registerPlannerImportHandlers } from './handlers/planner-import'
import { registerRepoDiscoveryHandlers } from './handlers/repo-discovery'
import { closeDb } from './db'
import { createAgentManager } from './agent-manager'
import { createSprintTaskRepository } from './data/sprint-task-repository'
import { getOAuthToken, ensureExtraPathsOnProcessEnv } from './env-utils'
import { createLogger } from './logger'
import { setSprintQueriesLogger } from './data/sprint-queries'

// Augment process.env.PATH so child_process.spawn() can find user-installed
// CLIs (claude, gh, git, node) when launched from Finder/Spotlight. Must run
// before any whenReady-time spawn (agent-manager, status-server, adhoc agents).
ensureExtraPathsOnProcessEnv()
import { getSetting, getSettingJson } from './settings'
import { createTaskTerminalService } from './services/task-terminal-service'
import { createStatusServer } from './services/status-server'
import { createElectronDialogService } from './dialog-service'
import { getTask, updateTask } from './services/sprint-service'
import { getGroup, getGroupTasks, getGroupsWithDependencies } from './data/task-group-queries'
import {
  registerTearoffHandlers,
  closeTearoffWindows,
  setQuitting,
  SHARED_WEB_PREFERENCES,
  restoreTearoffWindows
} from './tearoff-manager'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0A0A0A',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: SHARED_WEB_PREFERENCES
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const appUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : `file://${join(__dirname, '../renderer/index.html')}`

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('before-quit', () => {
  setQuitting()
  closeTearoffWindows()
  closeDb()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bde')

  initializeDatabase()

  const stopDbWatcher = startDbWatcher()
  app.on('will-quit', stopDbWatcher)

  startBackgroundServices()

  // Hoist repo construction so it's available to BOTH the terminal service
  // (always) and the agent manager (when autoStart).
  const repo = createSprintTaskRepository()

  // --- Task terminal service (unified dependency resolution) ---
  const terminalService = createTaskTerminalService({
    getTask,
    updateTask,
    getTasksWithDependencies: () => repo.getTasksWithDependencies(),
    getGroup,
    getGroupsWithDependencies,
    listGroupTasks: getGroupTasks,
    getSetting,
    logger: createLogger('task-terminal')
  })
  const dialogService = createElectronDialogService()
  const terminalDeps = {
    onStatusTerminal: terminalService.onStatusTerminal,
    dialog: dialogService
  }

  startPrPollers(terminalDeps)
  setupCleanupTasks()

  // --- Agent Manager initialization ---
  const amConfig = {
    maxConcurrent: getSettingJson<number>('agentManager.maxConcurrent') ?? 2,
    worktreeBase: getSetting('agentManager.worktreeBase') ?? join(homedir(), 'worktrees', 'bde'),
    maxRuntimeMs: getSettingJson<number>('agentManager.maxRuntimeMs') ?? 3_600_000,
    idleTimeoutMs: 900_000,
    pollIntervalMs: 30_000,
    defaultModel: getSetting('agentManager.defaultModel') ?? 'claude-sonnet-4-5'
  }

  const autoStart = getSettingJson<boolean>('agentManager.autoStart') ?? true

  // Start agent manager immediately — auth is checked inside the drain loop
  if (autoStart) {
    getOAuthToken()

    // Wire sprint-queries to use the same structured file logger as the agent manager
    const logger = createLogger('agent-manager')
    setSprintQueriesLogger(logger)

    const am = createAgentManager(
      { ...amConfig, onStatusTerminal: terminalService.onStatusTerminal },
      repo,
      logger
    )
    am.start()
    app.on('will-quit', () => am.stop(10_000))

    // Start status server (read-only monitoring endpoint)
    const statusServer = createStatusServer(am, repo)
    statusServer.start().catch((err) => {
      createLogger('startup').error(`Failed to start status server: ${err}`)
    })
    app.on('will-quit', () => statusServer.stop())

    registerAgentHandlers(am)
    registerAgentManagerHandlers(am)
    registerWorkbenchHandlers(am)
  } else {
    registerAgentHandlers()
    registerAgentManagerHandlers(undefined)
    registerWorkbenchHandlers()
  }

  registerSynthesizerHandlers()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerConfigHandlers()
  registerGitHandlers(terminalDeps)
  registerTerminalHandlers()
  registerWindowHandlers()
  registerSprintLocalHandlers(terminalDeps)
  registerCostHandlers()
  registerTemplateHandlers()
  registerFsHandlers()
  registerIdeFsHandlers()
  registerMemorySearchHandler()
  registerAuthHandlers()
  registerDashboardHandlers()
  registerTearoffHandlers()
  registerClaudeConfigHandlers()
  registerReviewHandlers(terminalDeps)

  // AI Review Partner
  const reviewDb = getDb()
  const reviewRepo = createReviewRepository(reviewDb)
  const sprintTaskRepository = createSprintTaskRepository()
  const reviewServiceLogger = createLogger('review-service')

  function resolveWorktreePathViaRepo(taskId: string): string {
    const task = sprintTaskRepository.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!task.worktree_path) {
      throw new Error(`Task ${taskId} has no worktree_path`)
    }
    return task.worktree_path
  }

  const getHeadCommitSha = async (worktreePath: string): Promise<string> => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])
    return stdout.trim()
  }

  const getBranch = async (worktreePath: string): Promise<string> => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('git', [
      '-C',
      worktreePath,
      'rev-parse',
      '--abbrev-ref',
      'HEAD'
    ])
    return stdout.trim()
  }

  const getDiff = async (worktreePath: string): Promise<string> => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'diff', 'main...HEAD'], {
      maxBuffer: 10 * 1024 * 1024
    })
    return stdout
  }

  const reviewService = createReviewService({
    repo: reviewRepo,
    taskRepo: sprintTaskRepository,
    logger: reviewServiceLogger,
    resolveWorktreePath: async (taskId) => resolveWorktreePathViaRepo(taskId),
    getHeadCommitSha,
    getDiff,
    getBranch,
    runSdkOnce
  })

  const reviewActiveStreams = new Map<string, { close: () => void }>()
  registerReviewAssistantHandlers({
    reviewService,
    chatStreamDeps: buildChatStreamDeps({
      taskRepo: sprintTaskRepository,
      reviewRepo,
      getHeadCommitSha,
      getBranch,
      getDiff,
      activeStreams: reviewActiveStreams
    })
  })

  registerWebhookHandlers()
  registerGroupHandlers()
  registerPlannerImportHandlers({ dialog: dialogService })
  registerRepoDiscoveryHandlers()

  setupCSP()

  createWindow()
  restoreTearoffWindows()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
