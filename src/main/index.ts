import { app, shell, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { watch, type FSWatcher } from 'fs'
import { BDE_DB_PATH } from './paths'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerAgentHandlers } from './handlers/agent-handlers'
import { registerGitHandlers } from './handlers/git-handlers'
import { registerTerminalHandlers } from './handlers/terminal-handlers'
import { registerConfigHandlers } from './handlers/config-handlers'
import { registerGatewayHandlers } from './handlers/gateway-handlers'
import { registerWindowHandlers } from './handlers/window-handlers'
import { registerSprintLocalHandlers } from './handlers/sprint-local'
import { registerCostHandlers } from './handlers/cost-handlers'
import { registerQueueHandlers } from './handlers/queue-handlers'
import { registerFsHandlers } from './fs'
import { registerTemplateHandlers } from './handlers/template-handlers'
import { getDb, closeDb } from './db'
import { migrateFromOpenClawConfig } from './settings'
import { startSprintSseClient, stopSprintSseClient } from './sprint-sse'
import { startPrPoller, stopPrPoller } from './pr-poller'
import { startSprintPrPoller, stopSprintPrPoller } from './sprint-pr-poller'
import { getGatewayConfig } from './config'
import { startQueueApi, stopQueueApi } from './queue-api/server'
import { pruneOldEvents } from './agents/event-store'
import { getEventRetentionDays } from './config'

const DEBOUNCE_MS = 500

function startDbWatcher(): () => void {
  const dbPath = BDE_DB_PATH
  const walPath = dbPath + '-wal'
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const notify = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('sprint:externalChange')
      }
    }, DEBOUNCE_MS)
  }

  const watchers: FSWatcher[] = []

  for (const path of [dbPath, walPath]) {
    try {
      watchers.push(watch(path, notify))
    } catch {
      // File may not exist yet — task runner creates it on first write
    }
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    for (const w of watchers) w.close()
  }
}


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
  migrateFromOpenClawConfig()

  const stopDbWatcher = startDbWatcher()
  app.on('will-quit', stopDbWatcher)

  startSprintSseClient()
  app.on('will-quit', stopSprintSseClient)

  startPrPoller()
  app.on('will-quit', stopPrPoller)

  startSprintPrPoller()
  app.on('will-quit', stopSprintPrPoller)

  startQueueApi()
  app.on('will-quit', stopQueueApi)

  pruneOldEvents(getEventRetentionDays())

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerConfigHandlers()
  registerAgentHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerGatewayHandlers()
  registerWindowHandlers()
  registerSprintLocalHandlers()
  registerCostHandlers()
  registerQueueHandlers()
  registerTemplateHandlers()
  registerFsHandlers()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Build connect-src dynamically from gateway config
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

function buildConnectSrc(): string {
  const config = getGatewayConfig()
  if (!config) return 'ws://127.0.0.1:* wss://127.0.0.1:*'
  try {
    const url = new URL(config.url.replace(/^ws/, 'http'))
    const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const httpProto = url.protocol === 'https:' ? 'https:' : 'http:'
    return `${wsProto}//${url.host} ${httpProto}//${url.host}`
  } catch {
    return 'ws://127.0.0.1:* wss://127.0.0.1:*'
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
