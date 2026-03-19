import { BrowserWindow, ipcMain, shell } from 'electron'
import { safeHandle } from '../ipc-utils'
import { isKnownAgentPid } from '../local-agents'

const ALLOWED_URL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

export function registerWindowHandlers(): void {
  safeHandle('window:openExternal', (_e, url) => {
    const parsed = new URL(url)
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Blocked URL scheme: "${parsed.protocol}"`)
    }
    return shell.openExternal(url)
  })

  safeHandle('agent:killLocal', async (_event, pid: number) => {
    if (!isKnownAgentPid(pid)) {
      return { ok: false, error: 'PID is not a known agent process' }
    }
    try {
      process.kill(pid, 'SIGTERM')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.on('window:setTitle', (_e, title: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win) win.setTitle(title)
  })
}
