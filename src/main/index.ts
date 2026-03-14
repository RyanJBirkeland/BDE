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

  // Load gateway config and expose via IPC
  let gatewayConfig: { url: string; token: string }
  try {
    gatewayConfig = getGatewayConfig()
  } catch {
    return // getGatewayConfig shows error dialog and quits
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

  // Git IPC handlers
  ipcMain.handle('get-diff', (_e, repoPath: string, base?: string) => getDiff(repoPath, base))
  ipcMain.handle('get-branch', (_e, repoPath: string) => getBranch(repoPath))
  ipcMain.handle('get-log', (_e, repoPath: string, n?: number) => getLog(repoPath, n))

  // Git client IPC handlers
  ipcMain.handle('git:status', (_e, cwd: string) => gitStatus(cwd))
  ipcMain.handle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(cwd, file))
  ipcMain.handle('git:stage', (_e, cwd: string, files: string[]) => gitStage(cwd, files))
  ipcMain.handle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(cwd, files))
  ipcMain.handle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
  ipcMain.handle('git:push', (_e, cwd: string) => gitPush(cwd))
  ipcMain.handle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  ipcMain.handle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(cwd, branch))

  // Window title
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
