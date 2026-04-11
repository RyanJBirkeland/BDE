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
import { registerPlaygroundHandlers } from './handlers/playground-handlers'
import { registerDashboardHandlers } from './handlers/dashboard-handlers'
import { registerSynthesizerHandlers } from './handlers/synthesizer-handlers'
import { registerClaudeConfigHandlers } from './handlers/claude-config-handlers'
import { registerReviewHandlers } from './handlers/review'
import { registerWebhookHandlers } from './handlers/webhook-handlers'
import { registerGroupHandlers } from './handlers/group-handlers'
import { registerPlannerImportHandlers } from './handlers/planner-import'
import { registerRepoDiscoveryHandlers } from './handlers/repo-discovery'
import { closeDb } from './db'
import { createAgentManager } from './agent-manager'
import { createSprintTaskRepository } from './data/sprint-task-repository'
import { getOAuthToken, ensureExtraPathsOnProcessEnv } from './env-utils'
import { createLogger } from './logger'

// Augment process.env.PATH so child_process.spawn() can find user-installed
// CLIs (claude, gh, git, node) when launched from Finder/Spotlight. Must run
// before any whenReady-time spawn (agent-manager, status-server, adhoc agents).
ensureExtraPathsOnProcessEnv()
import { getSetting, getSettingJson } from './settings'
import { createTaskTerminalService } from './services/task-terminal-service'
import { createStatusServer } from './services/status-server'
import { createElectronDialogService } from './dialog-service'
import { getTasksWithDependencies } from './data/sprint-queries'
import { getTask, updateTask } from './services/sprint-service'
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

  // --- Task terminal service (unified dependency resolution) ---
  const terminalService = createTaskTerminalService({
    getTask,
    updateTask,
    getTasksWithDependencies,
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

    const repo = createSprintTaskRepository()
    const am = createAgentManager(
      { ...amConfig, onStatusTerminal: terminalService.onStatusTerminal },
      repo
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
  registerPlaygroundHandlers()
  registerDashboardHandlers()
  registerTearoffHandlers()
  registerClaudeConfigHandlers()
  registerReviewHandlers(terminalDeps)
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
