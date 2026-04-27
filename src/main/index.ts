import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { DEFAULT_PIPELINE_WORKTREE_BASE } from './paths'
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
import { resolveAgentRuntime } from './agent-manager/backend-selector'
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
import {
  attachRendererLoadRetry,
  MAX_RENDERER_LOAD_RETRIES,
  RENDERER_RETRY_BASE_DELAY_MS,
  ERR_ABORTED,
  READY_TO_SHOW_FALLBACK_MS
} from './renderer-load-retry'
import { getSetting, getSettingJson, getMcpEnabled, getMcpPort } from './settings'
import { createMcpServer, type McpServerHandle } from './mcp-server'
import { onSettingChanged } from './events/settings-events'
import { createEpicGroupService } from './services/epic-group-service'
import { createTaskTerminalService, createPollerTerminalDispatcher } from './services/task-terminal-service'
import { createTaskStateService } from './services/task-state-service'
import { createStatusServer } from './services/status-server'
import { createElectronDialogService } from './dialog-service'
import { getTask, updateTask } from './services/sprint-service'
import { createSprintMutations } from './services/sprint-mutations'
import { setSprintBroadcaster } from './services/sprint-mutation-broadcaster'
import { setReviewOrchestrationRepo } from './services/review-orchestration-service'
import { setShipBatchRepo } from './services/review-ship-batch'
import {
  closeTearoffWindows,
  setQuitting,
  SHARED_WEB_PREFERENCES,
  restoreTearoffWindows
} from './tearoff-manager'
import { clearAnthropicEnvVars } from './auth-guard'
import { broadcast } from './broadcast'

// Side-effecting startup steps run before any whenReady-time work touches
// process.env, the network, or the singleton lock. Order matters: PATH first,
// then the proxy dispatcher, then the singleton check, finally the Node
// version assertion.
runStartupPreflight()

function runStartupPreflight(): void {
  // Clear raw API key env vars before any agent or service code runs.
  // BDE authenticates via the OAuth token written to ~/.bde/oauth-token;
  // a stray ANTHROPIC_API_KEY in the environment would bypass that path
  // and could allow unauthenticated cost accumulation.
  clearAnthropicEnvVars()
  // Augment process.env.PATH so child_process.spawn() can find user-installed
  // CLIs (claude, gh, git, node) when launched from Finder/Spotlight. Must run
  // before any whenReady-time spawn (agent-manager, status-server, adhoc agents).
  ensureExtraPathsOnProcessEnv()
  configureGlobalProxyDispatcher()
  enforceSingleInstanceLock()
  assertSupportedNodeVersion()
}

function configureGlobalProxyDispatcher(): void {
  // Node.js 22's built-in fetch (undici) does NOT read HTTP_PROXY/HTTPS_PROXY
  // automatically — this global dispatcher bridges the gap so all main-process
  // fetch() calls respect corporate proxy settings. Subprocess spawns inherit
  // proxy vars via ENV_ALLOWLIST in env-utils.ts.
  const proxyUrl =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl))
}

function enforceSingleInstanceLock(): void {
  // A second launch focuses the existing window instead of opening another,
  // avoiding concurrent DB writes.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
  }
}

function assertSupportedNodeVersion(): void {
  const [nodeMajor = 0] = process.versions.node.split('.').map(Number)
  if (nodeMajor >= 22) return
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

/**
 * Creates the main BrowserWindow with standard configuration.
 * Returns null if window creation fails (e.g., headless system).
 */
function createMainWindow(): BrowserWindow | null {
  try {
    return new BrowserWindow({
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
    logError(
      logger,
      'Failed to create main BrowserWindow',
      err instanceof Error ? err : new Error(String(err))
    )
    // Headless systems (no display server) cause `new BrowserWindow()` to
    // throw. Without this guard the process hangs silently. Surface the
    // failure and quit so the launcher's exit code is diagnostic.
    const message = err instanceof Error ? err.message : String(err)
    dialog.showErrorBox(
      'BDE could not open its window',
      `The application failed to create its main window.\n\nDetails: ${message}\n\nThis typically means BDE was launched on a system with no display, or Electron could not initialize a graphics context.`
    )
    app.quit()
    return null
  }
}

/**
 * Installs a fallback timer to show the window if ready-to-show doesn't fire within the timeout period.
 * Clears the timer when the window is closed.
 */
function installReadyToShowFallback(win: BrowserWindow): void {
  let windowShown = false
  const fallbackTimer = setTimeout(() => {
    if (windowShown || win.isDestroyed()) return
    win.show()
    emitStartupWarnings()
    windowShown = true
  }, READY_TO_SHOW_FALLBACK_MS)

  win.on('ready-to-show', () => {
    if (windowShown || win.isDestroyed()) return
    win.show()
    emitStartupWarnings()
    windowShown = true
  })

  win.on('closed', () => {
    clearTimeout(fallbackTimer)
  })
}

/**
 * Configures the window-open handler to allow external links in approved schemes and deny all popup windows.
 */
function installExternalLinkHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler((details) => {
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
}

/**
 * Prevents navigation to URLs outside the application's origin.
 */
function installNavigationGuard(win: BrowserWindow, appUrl: string): void {
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault()
    }
  })
}

/**
 * Resolves the application URL based on environment (dev server or production file path).
 */
function resolveAppUrl(): string {
  return is.dev && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : `file://${join(__dirname, '../renderer/index.html')}`
}

/**
 * Loads the renderer entry point using the appropriate method for the environment.
 */
function loadRendererEntry(win: BrowserWindow): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createWindow(): void {
  const mainWindow = createMainWindow()
  if (!mainWindow) return
  installReadyToShowFallback(mainWindow)
  attachRendererLoadRetry(mainWindow)
  installExternalLinkHandler(mainWindow)
  installNavigationGuard(mainWindow, resolveAppUrl())
  loadRendererEntry(mainWindow)
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

/**
 * Applies pending database migrations. On failure, surfaces an actionable
 * dialog and exits — we cannot continue past a broken schema.
 */
function initDatabaseOrExit(): void {
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
}

interface CoreStartupServices {
  repo: ReturnType<typeof createSprintTaskRepository>
  epicGroupService: ReturnType<typeof createEpicGroupService>
  terminalService: ReturnType<typeof createTaskTerminalService>
  /** TaskStateService wired with the poller/manual terminal dispatcher. */
  pollerTaskStateService: ReturnType<typeof createTaskStateService>
  terminalDeps: {
    onStatusTerminal: ReturnType<typeof createTaskTerminalService>['onStatusTerminal']
    dialog: ReturnType<typeof createElectronDialogService>
    taskStateService: ReturnType<typeof createTaskStateService>
  }
}

/**
 * Wires the repo, EpicGroupService, TaskTerminalService, TaskStateService,
 * and the pollers that every other startup stage depends on.
 */
function initCoreServices(): CoreStartupServices {
  const stopDbWatcher = startDbWatcher()
  app.on('will-quit', stopDbWatcher)
  startBackgroundServices()

  const repo = createSprintTaskRepository()
  // Bind all sprint mutation functions to the composition-root repo instance.
  // The free-function exports in sprint-mutations.ts delegate to this bound object.
  createSprintMutations(repo)
  // Wire the repo into review services that previously called getSharedSprintTaskRepository().
  setReviewOrchestrationRepo(repo)
  setShipBatchRepo(repo)
  // Wire the IPC broadcast function into sprint-mutation-broadcaster so it
  // can notify renderer windows without importing the framework adapter directly.
  setSprintBroadcaster(() => broadcast('sprint:externalChange'))

  // The epic dependency graph has one owner — EpicGroupService, constructed
  // at the composition root and injected to every consumer (task-terminal-
  // service, agent manager, MCP server, IPC handlers).
  const epicGroupService = createEpicGroupService()

  const terminalService = createTaskTerminalService({
    getTask,
    updateTask,
    getTasksWithDependencies: () => repo.getTasksWithDependencies(),
    getGroup: (id) => repo.getGroup(id),
    listGroupTasks: (groupId) => repo.getGroupTasks(groupId),
    epicDepsReader: epicGroupService,
    getSetting,
    runInTransaction: (fn) => getDb().transaction(fn)(),
    broadcast: (channel, payload) =>
      broadcast(channel as 'task-terminal:resolution-error', payload as { error: string }),
    logger: createLogger('task-terminal')
  })

  // TaskStateService for IPC handlers, review services, and the PR poller path.
  // Uses the poller dispatcher so terminal status changes schedule dependency
  // resolution via the batched setTimeout(0) approach (vs. agent-manager's inline approach).
  const pollerTaskStateService = createTaskStateService({
    terminalDispatcher: createPollerTerminalDispatcher(terminalService),
    logger: createLogger('task-state')
  })

  const dialogService = createElectronDialogService()
  const terminalDeps = {
    onStatusTerminal: terminalService.onStatusTerminal,
    dialog: dialogService,
    taskStateService: pollerTaskStateService
  }

  startPrPollers(terminalDeps)
  setupCleanupTasks()

  return { repo, epicGroupService, terminalService, pollerTaskStateService, terminalDeps }
}

/**
 * Starts the agent manager (when autoStart is enabled), the read-only
 * status server, and the opt-in MCP server. Wires the setting-change
 * listener so `mcp.enabled` / `mcp.port` toggles hot-swap the server
 * without a restart.
 *
 * Returns the AgentManager handle for downstream registerAllHandlers
 * consumption, or undefined when autoStart is disabled.
 */
function wireAgentManagerAndMcp(
  core: CoreStartupServices
): ReturnType<typeof createAgentManager> | undefined {
  const amConfig = {
    maxConcurrent: getSettingJson<number>('agentManager.maxConcurrent') ?? 2,
    worktreeBase: getSetting('agentManager.worktreeBase') ?? DEFAULT_PIPELINE_WORKTREE_BASE,
    maxRuntimeMs: getSettingJson<number>('agentManager.maxRuntimeMs') ?? 3_600_000,
    idleTimeoutMs: 900_000,
    pollIntervalMs: 30_000,
    defaultModel: getSetting('agentManager.defaultModel') ?? 'claude-sonnet-4-5'
  }

  const autoStart = getSettingJson<boolean>('agentManager.autoStart') ?? true
  if (!autoStart) return undefined

  getOAuthToken()

  const amLogger = createLogger('agent-manager')
  setSprintQueriesLogger(amLogger)
  setTaskGroupQueriesLogger(createLogger('task-group-queries'))
  setSettingsQueriesLogger(createLogger('settings-queries'))

  const agentManager = createAgentManager(
    { ...amConfig, onStatusTerminal: core.terminalService.onStatusTerminal },
    core.repo,
    amLogger,
    core.epicGroupService
  )
  agentManager.start()

  const statusServer = createStatusServer(
    agentManager,
    core.repo,
    undefined,
    undefined,
    (channel, payload) => broadcast(channel as 'manager:warning', payload as { message: string })
  )
  statusServer.start().catch((err) => {
    createLogger('startup').error(`Failed to start status server: ${err}`)
  })

  let mcp: McpServerHandle | null = null

  async function startMcpServer(): Promise<void> {
    if (mcp) return
    const port = getMcpPort()
    const handle = createMcpServer(
      {
        epicService: core.epicGroupService,
        onStatusTerminal: core.terminalService.onStatusTerminal,
        taskStateService: core.pollerTaskStateService
      },
      { port }
    )
    try {
      await handle.start()
      mcp = handle
    } catch (err) {
      createLogger('startup').error(`Failed to start MCP server: ${err}`)
    }
  }

  async function stopMcpServer(): Promise<void> {
    if (!mcp) return
    await mcp.stop()
    mcp = null
  }

  if (getMcpEnabled()) {
    startMcpServer().catch(() => {})
  }

  onSettingChanged(({ key, value }) => {
    if (key === 'mcp.enabled') {
      if (value === 'true') startMcpServer().catch(() => {})
      else stopMcpServer().catch(() => {})
      return
    }
    if (key === 'mcp.port' && mcp !== null) {
      stopMcpServer()
        .then(() => startMcpServer())
        .catch(() => {})
    }
  })

  app.on('will-quit', () => {
    agentManager.stop(10_000)
    statusServer.stop()
    stopMcpServer().catch(() => {})
  })

  return agentManager
}

/**
 * Builds the AI Review Partner pieces: the review repository, the git
 * adapter closures (resolveWorktreePath, getHeadCommitSha, getBranch,
 * getDiff), the ReviewService, and the chat-stream deps the IPC
 * handlers need.
 */
function buildReviewWiring(repo: ReturnType<typeof createSprintTaskRepository>): {
  reviewService: ReturnType<typeof createReviewService>
  reviewChatStreamDeps: ReturnType<typeof buildChatStreamDeps>
} {
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
    resolveAgentRuntime: () => resolveAgentRuntime('reviewer'),
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

  return { reviewService, reviewChatStreamDeps }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bde')

  initDatabaseOrExit()
  const core = initCoreServices()
  const agentManager = wireAgentManagerAndMcp(core)
  const review = buildReviewWiring(core.repo)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const handlerDeps: AppHandlerDeps = {
    agentManager,
    terminalDeps: core.terminalDeps,
    reviewService: review.reviewService,
    reviewChatStreamDeps: review.reviewChatStreamDeps,
    repo: core.repo,
    epicGroupService: core.epicGroupService
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

// Re-export renderer load retry utilities for external use
export {
  attachRendererLoadRetry,
  MAX_RENDERER_LOAD_RETRIES,
  RENDERER_RETRY_BASE_DELAY_MS,
  ERR_ABORTED,
  READY_TO_SHOW_FALLBACK_MS
}

// Export window helper functions for testing
export {
  createMainWindow,
  installReadyToShowFallback,
  installExternalLinkHandler,
  installNavigationGuard,
  resolveAppUrl,
  loadRendererEntry
}
