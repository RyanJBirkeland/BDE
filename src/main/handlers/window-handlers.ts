import { BrowserWindow, ipcMain, shell } from 'electron'
import { safeHandle } from '../ipc-utils'

export function registerWindowHandlers(): void {
  // TODO: AX-S1 — add 'open-external', 'kill-local-agent' to IpcChannelMap
  safeHandle('open-external', (_e, url: string) => shell.openExternal(url))

  safeHandle('kill-local-agent', async (_event, pid: number) => {
    try {
      process.kill(pid, 'SIGTERM')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.on('set-title', (_e, title: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win) win.setTitle(title)
  })
}
