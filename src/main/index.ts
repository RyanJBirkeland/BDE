import { app, shell, BrowserWindow, session } from 'electron'
import { join } from 'path'
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
import { getDb, closeDb } from './db'
import { startPrPoller, stopPrPoller } from './pr-poller'
import { startSprintPrPoller, stopSprintPrPoller } from './sprint-pr-poller'
import { startQueueApi, stopQueueApi } from './queue-api'
import { pruneOldEvents } from './data/event-queries'
import { getEventRetentionDays } from './config'
import { createAgentManager } from './agent-manager'
import { preloadOAuthToken } from './agent-manager/sdk-adapter'
import { getSetting, getSettingJson } from './settings'

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // TODO(security): sandbox:false is required because the preload script uses
      // Node.js APIs (fs, child_process) via contextBridge. Migrate preload to
      // message-port IPC to re-enable sandbox. Reviewed 2026-03-18.
      sandbox: false,
      contextIsolation: true
    }
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
  closeDb()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bde')

  getDb()

  const stopDbWatcher = startDbWatcher()
  app.on('will-quit', stopDbWatcher)

  startPrPoller()
  app.on('will-quit', stopPrPoller)

  startSprintPrPoller()
  app.on('will-quit', stopSprintPrPoller)

  startQueueApi({ port: 18790 })
  app.on('will-quit', () => stopQueueApi())

  pruneOldEvents(getDb(), getEventRetentionDays())

  // --- Agent Manager initialization ---
  const amConfig = {
    maxConcurrent: getSettingJson<number>('agentManager.maxConcurrent') ?? 2,
    worktreeBase: getSetting('agentManager.worktreeBase') ?? '/tmp/worktrees/bde',
    maxRuntimeMs: getSettingJson<number>('agentManager.maxRuntimeMs') ?? 3_600_000,
    idleTimeoutMs: 900_000,
    pollIntervalMs: 30_000,
    defaultModel: getSetting('agentManager.defaultModel') ?? 'claude-sonnet-4-5',
  }

  const autoStart = getSettingJson<boolean>('agentManager.autoStart') ?? true

  // Start agent manager immediately — auth is checked inside the drain loop
  if (autoStart) {
    preloadOAuthToken()

    const am = createAgentManager(amConfig)
    am.start()
    app.on('will-quit', () => am.stop(10_000))

    registerAgentHandlers(am)
    registerAgentManagerHandlers(am)
    registerWorkbenchHandlers(am)
  } else {
    registerAgentHandlers()
    registerAgentManagerHandlers(undefined)
    registerWorkbenchHandlers()
  }

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

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectSrc = buildConnectSrc()

    const csp = is.dev
      ? "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        `connect-src 'self' ${connectSrc} http://localhost:* ws://localhost:*`
      : "default-src 'self'; " +
        "script-src 'self'; " +
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
