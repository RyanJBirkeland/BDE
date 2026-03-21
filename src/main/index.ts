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
import { registerWindowHandlers } from './handlers/window-handlers'
import { registerSprintLocalHandlers } from './handlers/sprint-local'
import { registerCostHandlers } from './handlers/cost-handlers'
import { registerFsHandlers } from './fs'
import { registerTemplateHandlers } from './handlers/template-handlers'
import { registerAuthHandlers } from './handlers/auth-handlers'
import { registerAgentManagerHandlers } from './handlers/agent-manager-handlers'
import { AgentManager, createWorktree, handleAgentCompletion, type QueuedTask, type CompletionContext } from './agent-manager'
import { SdkProvider } from './agents'
import { ensureSubscriptionAuth } from './auth-guard'
import { getEventBus } from './agents/event-bus'
import type { AgentEvent } from './agents/types'
import { getMaxConcurrent, getWorktreeBase, getMaxRuntimeMinutes, getSettingJson } from './settings'
import { getDb, closeDb } from './db'
import { startPrPoller, stopPrPoller } from './pr-poller'
import { startSprintPrPoller, stopSprintPrPoller } from './sprint-pr-poller'
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

  const stopDbWatcher = startDbWatcher()
  app.on('will-quit', stopDbWatcher)

  startPrPoller()
  app.on('will-quit', stopPrPoller)

  startSprintPrPoller()
  app.on('will-quit', stopSprintPrPoller)

  pruneOldEvents(getEventRetentionDays())

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerConfigHandlers()
  registerAgentHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerWindowHandlers()
  registerSprintLocalHandlers()
  registerCostHandlers()
  registerTemplateHandlers()
  registerFsHandlers()

  // Agent Manager setup
  const sdkProvider = new SdkProvider()
  const eventBus = getEventBus()

  const agentManager = new AgentManager({
    getQueuedTasks: async () => {
      const db = getDb()
      const rows = db.prepare(
        "SELECT * FROM sprint_tasks WHERE status = 'queued' ORDER BY priority ASC, created_at ASC"
      ).all()
      return rows as QueuedTask[]
    },
    updateTask: async (taskId: string, update: Record<string, unknown>) => {
      const db = getDb()
      const keys = Object.keys(update)
      const sets = keys.map(k => `${k} = ?`).join(', ')
      const values = keys.map(k => update[k])
      db.prepare(`UPDATE sprint_tasks SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, taskId)
    },
    ensureAuth: () => ensureSubscriptionAuth(),
    spawnAgent: async (opts) => {
      return sdkProvider.spawn({
        prompt: opts.prompt,
        workingDirectory: opts.cwd,
        model: opts.model,
      })
    },
    createWorktree: (repoPath, taskId, worktreeBase) => createWorktree(repoPath, taskId, worktreeBase),
    handleCompletion: async (ctx) => {
      await handleAgentCompletion({
        ...ctx,
        updateTask: async (update) => {
          const db = getDb()
          const keys = Object.keys(update)
          const sets = keys.map(k => `${k} = ?`).join(', ')
          const values = keys.map(k => update[k])
          db.prepare(`UPDATE sprint_tasks SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, ctx.taskId as string)
        },
      } as CompletionContext)
    },
    emitEvent: (agentId, event) => eventBus.emit('agent:event', agentId, event as AgentEvent),
    getRepoInfo: (repoName) => {
      const repos = getSettingJson<Array<{ name: string; localPath: string; githubOwner: string; githubRepo: string }>>('repos') ?? []
      const repo = repos.find(r => r.name === repoName)
      if (!repo) return null
      return { repoPath: repo.localPath, ghRepo: `${repo.githubOwner}/${repo.githubRepo}` }
    },
    config: {
      maxConcurrent: getMaxConcurrent(),
      worktreeBase: getWorktreeBase(),
      maxRuntimeMs: getMaxRuntimeMinutes() * 60_000,
      idleMs: 15 * 60_000,
      drainIntervalMs: 5_000,
    },
  })

  agentManager.start()
  app.on('will-quit', () => agentManager.stop())

  registerAuthHandlers()
  registerAgentManagerHandlers(agentManager)

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

function buildConnectSrc(): string {
  return 'https://api.github.com'
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
