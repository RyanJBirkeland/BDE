import { BrowserWindow, ipcMain, shell } from 'electron'
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'

const logger = createLogger('window-handlers')

const ALLOWED_URL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

export function registerWindowHandlers(): void {
  safeHandle('window:openExternal', (_e, url) => {
    const parsed = new URL(url)
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Blocked URL scheme: "${parsed.protocol}"`)
    }
    return shell.openExternal(url)
  })

  safeHandle('agent:killLocal', async (_event, _pid: number) => {
    // Local PID-based agent kill removed — use agent:kill with agent ID instead
    return {
      ok: false,
      error: 'Local PID-based agent kill removed. Use agent:kill with an agent ID instead.'
    }
  })

  ipcMain.on('window:setTitle', (_e, title: string) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (win && typeof title === 'string') win.setTitle(title)
    } catch (err) {
      logger.error(`setTitle: ${err}`)
    }
  })
}
