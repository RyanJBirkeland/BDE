import { app, shell, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { startDbWatcher, buildConnectSrc } from './bootstrap'
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
import { registerReviewHandlers, setReviewOnStatusTerminal } from './handlers/review'
import { registerWebhookHandlers } from './handlers/webhook-handlers'
import { registerGroupHandlers } from './handlers/group-handlers'
import { registerPlannerImportHandlers } from './handlers/planner-import'
import { getDb, closeDb, backupDatabase } from './db'
import { importSprintTasksFromSupabase } from './data/supabase-import'
import { startPrPoller, stopPrPoller } from './pr-poller'
import { startSprintPrPoller, stopSprintPrPoller } from './sprint-pr-poller'
import { pruneOldEvents } from './data/event-queries'
import { pruneOldChanges } from './data/task-changes'
import { getEventRetentionDays } from './config'
import { createAgentManager } from './agent-manager'
import { createSprintTaskRepository } from './data/sprint-task-repository'
import { getOAuthToken } from './env-utils'
import { getSetting, getSettingJson } from './settings'
import { createTaskTerminalService } from './services/task-terminal-service'
import { createStatusServer } from './services/status-server'
import {
  getTask,
  updateTask,
  getTasksWithDependencies,
  pruneOldDiffSnapshots,
  DIFF_SNAPSHOT_RETENTION_DAYS
} from './data/sprint-queries'
import { setOnStatusTerminal } from './handlers/sprint-local'
import { setGitHandlersOnStatusTerminal } from './handlers/git-handlers'
import { setOnTaskTerminal } from './sprint-pr-poller'
import { createLogger } from './logger'
import {
  registerTearoffHandlers,
  closeTearoffWindows,
  setQuitting,
  SHARED_WEB_PREFERENCES,
  restoreTearoffWindows
} from './tearoff-manager'
import { loadPlugins } from './services/plugin-loader'

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

  getDb()

  // Ensure Claude Code has sensible default permissions for BDE agents
  import('./claude-settings-bootstrap').then((m) => m.ensureClaudeSettings()).catch(() => {})

  // Run backup on startup and every 24 hours
  backupDatabase()
  const backupInterval = setInterval(backupDatabase, 24 * 60 * 60 * 1000)
  app.on('will-quit', () => clearInterval(backupInterval))

  // One-time async import from Supabase (no-op if local table already has rows or credentials missing)
  importSprintTasksFromSupabase(getDb()).catch((err) =>
    console.warn('[startup] Supabase import skipped:', err)
  )

  const stopDbWatcher = startDbWatcher()
  app.on('will-quit', stopDbWatcher)

  // Load plugins from ~/.bde/plugins/
  loadPlugins()

  // --- Task terminal service (unified dependency resolution) ---
  const terminalService = createTaskTerminalService({
    getTask,
    updateTask,
    getTasksWithDependencies,
    getSetting,
    logger: createLogger('task-terminal')
  })
  setOnStatusTerminal(terminalService.onStatusTerminal)
  setGitHandlersOnStatusTerminal(terminalService.onStatusTerminal)
  setOnTaskTerminal(terminalService.onStatusTerminal)
  setReviewOnStatusTerminal(terminalService.onStatusTerminal)

  startPrPoller()
  app.on('will-quit', stopPrPoller)

  startSprintPrPoller()
  app.on('will-quit', stopSprintPrPoller)

  pruneOldEvents(getDb(), getEventRetentionDays())

  // Prune agent_events periodically (every 24 hours)
  const pruneEventsInterval = setInterval(
    () => {
      try {
        pruneOldEvents(getDb(), getEventRetentionDays())
      } catch {
        /* non-fatal */
      }
    },
    24 * 60 * 60 * 1000
  )
  app.on('will-quit', () => clearInterval(pruneEventsInterval))

  // Prune old audit trail records (non-fatal)
  try {
    const pruned = pruneOldChanges(30)
    if (pruned > 0) createLogger('startup').info(`Pruned ${pruned} old task change records`)
  } catch (err) {
    createLogger('startup').warn(`Failed to prune task changes: ${err}`)
  }

  // Null out review_diff_snapshot blobs on long-completed tasks (non-fatal).
  // Snapshots can be ~500KB each — without this, the DB grows unbounded.
  try {
    const pruned = pruneOldDiffSnapshots(DIFF_SNAPSHOT_RETENTION_DAYS)
    if (pruned > 0)
      createLogger('startup').info(
        `Cleared review_diff_snapshot on ${pruned} terminal tasks older than ${DIFF_SNAPSHOT_RETENTION_DAYS} days`
      )
  } catch (err) {
    createLogger('startup').warn(`Failed to prune diff snapshots: ${err}`)
  }

  // Clean up test task artifacts (agents running tests create "Test task" records)
  try {
    const db = getDb()
    const result = db.prepare("DELETE FROM sprint_tasks WHERE title LIKE 'Test task%'").run()
    if (result.changes > 0) {
      createLogger('startup').info(`Cleaned ${result.changes} test task artifacts`)
    }
  } catch {
    /* non-fatal */
  }

  // Prune task_changes periodically (every 24 hours)
  const pruneTakeChangesInterval = setInterval(
    () => {
      try {
        pruneOldChanges(30)
      } catch {
        /* non-fatal */
      }
    },
    24 * 60 * 60 * 1000
  )
  app.on('will-quit', () => clearInterval(pruneTakeChangesInterval))

  // Prune review_diff_snapshot periodically (every 24 hours)
  const pruneDiffSnapshotsInterval = setInterval(
    () => {
      try {
        const cleared = pruneOldDiffSnapshots(DIFF_SNAPSHOT_RETENTION_DAYS)
        if (cleared > 0)
          createLogger('startup').info(`Cleared review_diff_snapshot on ${cleared} terminal tasks`)
      } catch {
        /* non-fatal */
      }
    },
    24 * 60 * 60 * 1000
  )
  app.on('will-quit', () => clearInterval(pruneDiffSnapshotsInterval))

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
  registerGitHandlers()
  registerTerminalHandlers()
  registerWindowHandlers()
  registerSprintLocalHandlers()
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
  registerReviewHandlers()
  registerWebhookHandlers()
  registerGroupHandlers()
  registerPlannerImportHandlers()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectSrc = buildConnectSrc()

    const csp = is.dev
      ? "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        `connect-src 'self' ${connectSrc} http://localhost:* ws://localhost:*`
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        `connect-src 'self' ${connectSrc} https://api.github.com`

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

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
