import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getGatewayConfig, getGitHubToken, saveGatewayConfig } from './config'
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

  ipcMain.handle('get-gateway-config', () => gatewayConfig)
  ipcMain.handle('get-github-token', () => getGitHubToken())
  ipcMain.handle('save-gateway-config', (_e, url: string, token: string) => {
    saveGatewayConfig(url, token)
    gatewayConfig = { url, token }
  })
  ipcMain.handle('get-repo-paths', () => getRepoPaths())
  ipcMain.handle('read-sprint-md', (_e, repoPath: string) => readSprintMd(repoPath))
  ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url))
  registerFsHandlers()

  // --- Local agent process detection + spawning ---
  ipcMain.handle('local:getAgentProcesses', () => getAgentProcesses())
  ipcMain.handle('local:spawnClaudeAgent', (_e, args: SpawnLocalAgentArgs) =>
    spawnClaudeAgent(args)
  )
  ipcMain.handle('local:tailAgentLog', (_e, args: TailLogArgs) => tailAgentLog(args))
  ipcMain.handle('local:sendToAgent', async (_e, { pid, message }: { pid: number; message: string }) => {
    const { sendToAgent } = await import('./local-agents')
    return sendToAgent(pid, message)
  })
  cleanupOldLogs()

  // --- Agent history IPC ---
  ipcMain.handle('agents:list', (_e, args: { limit?: number; status?: string }) =>
    listAgents(args.limit, args.status)
  )
  ipcMain.handle('agents:getMeta', (_e, args: { id: string }) =>
    getAgentMeta(args.id)
  )
  ipcMain.handle('agents:readLog', (_e, args: { id: string; fromByte?: number }) =>
    readLog(args.id, args.fromByte)
  )
  ipcMain.handle(
    'agents:import',
    (_e, args: { meta: Partial<AgentMeta>; content: string }) =>
      importAgent(args.meta, args.content)
  )
  ipcMain.handle('agents:markDone', async (_e, args: { id: string; exitCode: number }) => {
    await updateAgentMeta(args.id, {
      finishedAt: new Date().toISOString(),
      exitCode: args.exitCode,
      status: args.exitCode === 0 ? 'done' : 'failed'
    })
  })
  pruneOldAgents()

  // --- Git read-only IPC ---
  ipcMain.handle('get-diff', (_e, repoPath: string, base?: string) => getDiff(repoPath, base))
  ipcMain.handle('get-branch', (_e, repoPath: string) => getBranch(repoPath))
  ipcMain.handle('get-log', (_e, repoPath: string, n?: number) => getLog(repoPath, n))

  // --- Git client IPC ---
  ipcMain.handle('git:status', (_e, cwd: string) => gitStatus(cwd))
  ipcMain.handle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(cwd, file))
  ipcMain.handle('git:stage', (_e, cwd: string, files: string[]) => gitStage(cwd, files))
  ipcMain.handle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(cwd, files))
  ipcMain.handle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
  ipcMain.handle('git:push', (_e, cwd: string) => gitPush(cwd))
  ipcMain.handle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  ipcMain.handle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(cwd, branch))

  // --- Gateway tool invocation (proxied through main to avoid CORS) ---
  ipcMain.handle('gateway:invoke', async (_e, tool: string, args: Record<string, unknown>) => {
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

  ipcMain.handle(
    'terminal:create',
    (_e, { cols, rows }: { cols: number; rows: number }) => {
      if (!pty) throw new Error('Terminal unavailable: node-pty failed to load')
      const id = ++termId
      const shellPath = process.env.SHELL || '/bin/zsh'
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

  ipcMain.handle(
    'terminal:resize',
    (_e, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
      terminals.get(id)?.resize(cols, rows)
    }
  )

  ipcMain.handle('terminal:kill', (_e, id: number) => {
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
