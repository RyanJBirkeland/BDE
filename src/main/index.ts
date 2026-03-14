import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getGatewayConfig, getGitHubToken, saveGatewayConfig } from './config'
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
    return // getGatewayConfig shows error dialog and quits
  }

  // Return cached gateway URL + token
  ipcMain.handle('get-gateway-config', () => gatewayConfig)
  // Read GitHub token from openclaw.json or GITHUB_TOKEN env
  ipcMain.handle('get-github-token', () => getGitHubToken())
  // Persist new gateway URL + token to ~/.openclaw/openclaw.json
  ipcMain.handle('save-gateway-config', (_e, url: string, token: string) => {
    saveGatewayConfig(url, token)
    gatewayConfig = { url, token }
  })
  // Return hardcoded repo name → path map (BDE, life-os, feast)
  ipcMain.handle('get-repo-paths', () => getRepoPaths())
  // Read SPRINT.md from a given repo root
  ipcMain.handle('read-sprint-md', (_e, repoPath: string) => readSprintMd(repoPath))
  // Open a URL in the system browser
  ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url))
  // Register memory file-system handlers (list, read, write)
  registerFsHandlers()

  // --- Git read-only IPC ---
  // Get diff between current branch and base (defaults to origin/main)
  ipcMain.handle('get-diff', (_e, repoPath: string, base?: string) => getDiff(repoPath, base))
  // Get current branch name
  ipcMain.handle('get-branch', (_e, repoPath: string) => getBranch(repoPath))
  // Get recent commit log (oneline format, last n commits)
  ipcMain.handle('get-log', (_e, repoPath: string, n?: number) => getLog(repoPath, n))

  // --- Git client IPC (stage, commit, push) ---
  // Parse git status --porcelain into structured file list
  ipcMain.handle('git:status', (_e, cwd: string) => gitStatus(cwd))
  // Get combined staged + unstaged diff, optionally for a single file
  ipcMain.handle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(cwd, file))
  // Stage files for commit
  ipcMain.handle('git:stage', (_e, cwd: string, files: string[]) => gitStage(cwd, files))
  // Unstage files (git reset HEAD)
  ipcMain.handle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(cwd, files))
  // Create a commit with the given message
  ipcMain.handle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
  // Push current branch to remote
  ipcMain.handle('git:push', (_e, cwd: string) => gitPush(cwd))
  // List all local branches and identify the current one
  ipcMain.handle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  // Switch to a different branch
  ipcMain.handle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(cwd, branch))

  // --- Gateway tool invocation (proxied through main to avoid CORS) ---
  ipcMain.handle('gateway:invoke', async (_e, tool: string, args: Record<string, unknown>) => {
    const { url, token } = getGatewayConfig()
    const httpUrl = url.replace(/^wss?:\/\//, 'http://').replace(/\/$/, '')
    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool, args }),
    })
    if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`)
    return res.json()
  })

  // --- Window management ---
  // Set the window title bar text
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
