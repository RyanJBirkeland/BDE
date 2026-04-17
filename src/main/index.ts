import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProxyAgent, setGlobalDispatcher } from 'undici'
import {
  startDbWatcher,
  initializeDatabase,
  startBackgroundServices,
  startPrPollers,
  setupCleanupTasks,
  setupCSP,
  emitStartupWarnings
} from './bootstrap'
import icon from '../../resources/icon.png?asset'
import { registerAllHandlers, type AppHandlerDeps } from './handlers/registry'
import { buildChatStreamDeps } from './handlers/review-assistant'
import { createReviewRepository } from './data/review-repository'
import { createReviewService } from './services/review-service'
import { runSdkOnce } from './sdk-streaming'
import { getDb, closeDb } from './db'
import { flushAgentEventBatcher } from './agent-event-mapper'
import { createAgentManager } from './agent-manager'
import { createSprintTaskRepository } from './data/sprint-task-repository'
import { execFileAsync } from './lib/async-utils'
import { getOAuthToken, ensureExtraPathsOnProcessEnv } from './env-utils'
import { createLogger, logError } from './logger'
import { setSprintQueriesLogger } from './data/sprint-queries'
import { setTaskGroupQueriesLogger } from './data/task-group-queries'
import { setSettingsQueriesLogger } from './data/settings-queries'

// Augment process.env.PATH so child_process.spawn() can find user-installed
// CLIs (claude, gh, git, node) when launched from Finder/Spotlight. Must run
// before any whenReady-time spawn (agent-manager, status-server, adhoc agents).
ensureExtraPathsOnProcessEnv()

// Configure global undici ProxyAgent so all main-process fetch() calls respect
// corporate proxy settings. Node.js 22's built-in fetch (undici) does NOT read
// HTTP_PROXY/HTTPS_PROXY automatically — this global dispatcher bridges the gap.
// subprocess spawns inherit proxy vars via ENV_ALLOWLIST in env-utils.ts.
const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ??
  process.env.HTTP_PROXY ?? process.env.http_proxy
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl))
}

// Prevent two BDE instances from running simultaneously. A second launch focuses
// the existing window instead of opening a new one, avoiding concurrent DB writes.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
import { getSetting, getSettingJson } from './settings'
import { createTaskTerminalService } from './services/task-terminal-service'
import { createStatusServer } from './services/status-server'
import { createElectronDialogService } from './dialog-service'
import { getTask, updateTask } from './services/sprint-service'
import {
  closeTearoffWindows,
  setQuitting,
  SHARED_WEB_PREFERENCES,
  restoreTearoffWindows
} from './tearoff-manager'

// Enforce minimum Node.js version before any app logic
const [nodeMajor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 22) {
  process.stderr.write(
    `[BDE] Node.js v22+ required (found ${process.versions.node}). Please upgrade.\n`
  )
  process.exit(1)
}

const logger = createLogger('main')

const ALLOWED_EXTERNAL_SCHEMES = ['https:', 'http:', 'mailto:']

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3000

async function gracefulShutdown(): Promise<void> {
  const cleanup = async (): Promise<void> => {
    flushAgentEventBatcher()
    try {
      getDb().close()
    } catch (_) {
      // DB may already be closed — ignore
    }
    logger.info('Process exiting after uncaught exception')
  }
  await Promise.race([
    cleanup(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('cleanup timeout')), GRACEFUL_SHUTDOWN_TIMEOUT_MS)
    )
  ])
}

process.on('uncaughtException', async (err) => {
  logError(logger, 'Uncaught exception', err)
  try {
    await gracefulShutdown()
  } catch (cleanupErr) {
    logger.warn(`[main] Graceful shutdown failed: ${cleanupErr}`)
  } finally {
    process.exit(1)
  }
})

process.on('unhandledRejection', (reason) => {
  logError(
    logger,
    'Unhandled rejection',
    reason instanceof Error ? reason : new Error(String(reason))
  )
})

function createWindow(): void {
  let mainWindow: BrowserWindow
  try {
    mainWindow = new BrowserWindow({
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
  } catch (err) {
    logError(logger, 'Failed to create main BrowserWindow', err instanceof Error ? err : new Error(String(err)))
    // Headless systems (no display server) cause `new BrowserWindow()` to
    // throw. Without this guard the process hangs silently. Surface the
    // failure and quit so the launcher's exit code is diagnostic.
    const message = err instanceof Error ? err.message : String(err)
    dialog.showErrorBox(
      'BDE could not open its window',
      `The application failed to create its main window.\n\nDetails: ${message}\n\nThis typically means BDE was launched on a system with no display, or Electron could not initialize a graphics context.`
    )
    app.quit()
    return
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    emitStartupWarnings()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (ALLOWED_EXTERNAL_SCHEMES.includes(parsed.protocol)) {
        shell.openExternal(details.url).catch(() => {})
      }
    } catch {
      // Malformed URL — deny silently
    }
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

app.on('second-instance', () => {
  // A second BDE instance was launched — focus the existing window instead
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('before-quit', () => {
  setQuitting()
  closeTearoffWindows()
  closeDb()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bde')

  try {
    initializeDatabase()
  } catch (err) {
    dialog.showErrorBox(
      'Database Migration Failed',
      `BDE could not upgrade its database:\n\n${err instanceof Error ? err.message : String(err)}\n\n` +
      `Check ~/.bde/bde.log for details.\n` +
      `To recover: back up ~/.bde/bde.db, then delete it to start fresh.`
    )
    app.exit(1)
  }

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
    getGroup: (id) => repo.getGroup(id),
    getGroupsWithDependencies: () => repo.getGroupsWithDependencies(),
    listGroupTasks: (groupId) => repo.getGroupTasks(groupId),
    getSetting,
    runInTransaction: (fn) => getDb().transaction(fn)(),
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
  let agentManager: ReturnType<typeof createAgentManager> | undefined
  if (autoStart) {
    getOAuthToken()

    // Wire data modules to use the same structured file logger as the agent manager
    const logger = createLogger('agent-manager')
    setSprintQueriesLogger(logger)
    setTaskGroupQueriesLogger(createLogger('task-group-queries'))
    setSettingsQueriesLogger(createLogger('settings-queries'))

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

    agentManager = am
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // AI Review Partner setup
  const reviewDb = getDb()
  const reviewRepo = createReviewRepository(reviewDb)
  const reviewServiceLogger = createLogger('review-service')

  function resolveWorktreePathViaRepo(taskId: string): string {
    const task = repo.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (!task.worktree_path) {
      throw new Error(`Task ${taskId} has no worktree_path`)
    }
    return task.worktree_path
  }

  const getHeadCommitSha = async (worktreePath: string): Promise<string> => {
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])
    return stdout.trim()
  }

  const getBranch = async (worktreePath: string): Promise<string> => {
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
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'diff', 'main...HEAD'], {
      maxBuffer: 10 * 1024 * 1024
    })
    return stdout
  }

  const reviewService = createReviewService({
    repo: reviewRepo,
    taskRepo: repo,
    logger: reviewServiceLogger,
    resolveWorktreePath: async (taskId) => resolveWorktreePathViaRepo(taskId),
    getHeadCommitSha,
    getDiff,
    getBranch,
    runSdkOnce
  })

  const reviewActiveStreams = new Map<string, { close: () => void }>()
  const reviewChatStreamDeps = buildChatStreamDeps({
    taskRepo: repo,
    reviewRepo,
    getHeadCommitSha,
    getBranch,
    getDiff,
    activeStreams: reviewActiveStreams
  })

  // Register all IPC handlers
  const handlerDeps: AppHandlerDeps = {
    agentManager,
    terminalDeps,
    reviewService,
    reviewChatStreamDeps,
    repo
  }
  registerAllHandlers(handlerDeps)

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
