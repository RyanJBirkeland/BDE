import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getGatewayConfig, getGitHubToken, saveGatewayConfig, getSupabaseConfig } from './config'
// node-pty loaded lazily to avoid crashing main process if native module fails
let pty: typeof import('node-pty') | null = null
try { pty = require('node-pty') } catch { /* terminal unavailable */ }
import {
  getRepoPaths,
  readSprintMd,
  getDiff,
  getBranch,
  getLog,
  gitStatus,
  gitDiffFile,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitBranches,
  gitCheckout
} from './git'
import { registerFsHandlers } from './fs'
import {
  getAgentProcesses,
  spawnClaudeAgent,
  tailAgentLog,
  cleanupOldLogs
} from './local-agents'
import type { SpawnLocalAgentArgs, TailLogArgs } from './local-agents'
import {
  listAgents,
  getAgentMeta,
  readLog,
  importAgent,
  updateAgentMeta,
  pruneOldAgents
} from './agent-history'
import type { AgentMeta } from './agent-history'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeHandle(channel: string, handler: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await handler(e, ...args)
    } catch (err) {
      console.error(`[IPC:${channel}] unhandled error:`, err)
      throw err
    }
  })
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bde')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // --- Configuration IPC ---
  let gatewayConfig: { url: string; token: string }
  try {
    gatewayConfig = getGatewayConfig()
  } catch {
    return
  }

  safeHandle('get-gateway-config', () => gatewayConfig)
  safeHandle('get-github-token', () => getGitHubToken())
  safeHandle('save-gateway-config', (_e, url: string, token: string) => {
    saveGatewayConfig(url, token)
    gatewayConfig = { url, token }
  })
  safeHandle('get-supabase-config', () => getSupabaseConfig())
  safeHandle('get-repo-paths', () => getRepoPaths())
  safeHandle('read-sprint-md', (_e, repoPath: string) => readSprintMd(repoPath))
  safeHandle('open-external', (_e, url: string) => shell.openExternal(url))
  registerFsHandlers()

  // --- Local agent process detection + spawning ---
  safeHandle('local:getAgentProcesses', () => getAgentProcesses())
  safeHandle('local:spawnClaudeAgent', (_e, args: SpawnLocalAgentArgs) =>
    spawnClaudeAgent(args)
  )
  safeHandle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  safeHandle('local:sendToAgent', async (_e, { pid, message }: { pid: number; message: string }) => {
    const { sendToAgent } = await import('./local-agents')
    return sendToAgent(pid, message)
  })
  safeHandle('local:isInteractive', async (_e, pid: number) => {
    const { isAgentInteractive } = await import('./local-agents')
    return isAgentInteractive(pid)
  })
  safeHandle('kill-local-agent', async (_event, pid: number) => {
    try {
      process.kill(pid, 'SIGTERM')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
  cleanupOldLogs()

  // --- Agent history IPC ---
  safeHandle('agents:list', (_e, args: { limit?: number; status?: string }) =>
    listAgents(args.limit, args.status)
  )
  safeHandle('agents:getMeta', (_e, args: { id: string }) =>
    getAgentMeta(args.id)
  )
  safeHandle('agents:readLog', (_e, args: { id: string; fromByte?: number }) =>
    readLog(args.id, args.fromByte)
  )
  safeHandle(
    'agents:import',
    (_e, args: { meta: Partial<AgentMeta>; content: string }) =>
      importAgent(args.meta, args.content)
  )
  safeHandle('agents:markDone', async (_e, args: { id: string; exitCode: number }) => {
    await updateAgentMeta(args.id, {
      finishedAt: new Date().toISOString(),
      exitCode: args.exitCode,
      status: args.exitCode === 0 ? 'done' : 'failed'
    })
  })
  pruneOldAgents()

  // --- Session history (agent output tabs) ---
  safeHandle('sessions:getHistory', async (_event, _sessionKey: string) => {
    return []
  })

  // --- Git read-only IPC ---
  safeHandle('get-diff', (_e, repoPath: string, base?: string) => getDiff(repoPath, base))
  safeHandle('get-branch', (_e, repoPath: string) => getBranch(repoPath))
  safeHandle('get-log', (_e, repoPath: string, n?: number) => getLog(repoPath, n))

  // --- Git client IPC ---
  safeHandle('git:status', (_e, cwd: string) => gitStatus(cwd))
  safeHandle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(cwd, file))
  safeHandle('git:stage', (_e, cwd: string, files: string[]) => gitStage(cwd, files))
  safeHandle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(cwd, files))
  safeHandle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
  safeHandle('git:push', (_e, cwd: string) => gitPush(cwd))
  safeHandle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  safeHandle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(cwd, branch))

  // --- Gateway tool invocation (proxied through main to avoid CORS) ---
  safeHandle('gateway:invoke', async (_e, tool: string, args: Record<string, unknown>) => {
    const { url, token } = getGatewayConfig()
    const httpUrl = url.replace(/^wss?:\/\//, 'http://').replace(/\/$/, '')
    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool, args })
    })
    if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`)
    return res.json()
  })

  // --- Terminal PTY IPC ---
  const terminals = new Map<number, ReturnType<NonNullable<typeof pty>['spawn']>>()
  let termId = 0

  safeHandle(
    'terminal:create',
    (_e, { cols, rows, shell }: { cols: number; rows: number; shell?: string }) => {
      if (!pty) throw new Error('Terminal unavailable: node-pty failed to load')
      const id = ++termId
      const shellPath = shell || process.env.SHELL || '/bin/zsh'
      const p = pty.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.HOME || '/',
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
      })
      terminals.set(id, p)
      p.onData((data) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(`terminal:data:${id}`, data)
      })
      p.onExit(() => {
        terminals.delete(id)
        BrowserWindow.getAllWindows()[0]?.webContents.send(`terminal:exit:${id}`)
      })
      return id
    }
  )

  ipcMain.on('terminal:write', (_e, { id, data }: { id: number; data: string }) => {
    terminals.get(id)?.write(data)
  })

  safeHandle(
    'terminal:resize',
    (_e, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
      terminals.get(id)?.resize(cols, rows)
    }
  )

  safeHandle('terminal:kill', (_e, id: number) => {
    terminals.get(id)?.kill()
    terminals.delete(id)
  })

  // --- Window management ---
  ipcMain.on('set-title', (_e, title: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win) win.setTitle(title)
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
