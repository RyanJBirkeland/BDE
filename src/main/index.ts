import { app, shell, BrowserWindow, session, dialog } from 'electron'
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
import { registerSprintHandlers } from './handlers/sprint'
import { registerCostHandlers } from './handlers/cost-handlers'
import { registerCostHandlers as registerCostHistoryHandlers } from './handlers/cost'
import { registerFsHandlers } from './fs'
import { getDb, closeDb } from './db'
import { startSprintSseClient, stopSprintSseClient } from './sprint-sse'
import { startPrPoller, stopPrPoller } from './pr-poller'
import { GatewayConfigError, getGatewayConfig } from './config'

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

  // Validate gateway config early — show dialog and quit if missing
  try {
    getGatewayConfig()
  } catch (err) {
    if (err instanceof GatewayConfigError) {
      dialog.showErrorBox(
        err.reason === 'missing-token' ? 'BDE — Missing Gateway Token' : 'BDE — Config Not Found',
        err.message
      )
      app.quit()
      return
    }
  }

  const stopDbWatcher = startDbWatcher()
  app.on('will-quit', stopDbWatcher)

  startSprintSseClient()
  app.on('will-quit', stopSprintSseClient)

  startPrPoller()
  app.on('will-quit', stopPrPoller)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerConfigHandlers()
  registerAgentHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerGatewayHandlers()
  registerWindowHandlers()
  registerSprintHandlers()
  registerCostHandlers()
  registerCostHistoryHandlers()
  registerFsHandlers()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = is.dev
      ? "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' ws://127.0.0.1:* wss://127.0.0.1:* http://localhost:* ws://localhost:*"
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' ws://127.0.0.1:18789 wss://127.0.0.1:18789"
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
