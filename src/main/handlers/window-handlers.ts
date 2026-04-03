import { BrowserWindow, ipcMain, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
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

  ipcMain.on('window:setTitle', (_e, title: string) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (win && typeof title === 'string') win.setTitle(title)
    } catch (err) {
      logger.error(`setTitle: ${err}`)
    }
  })

  safeHandle('playground:openInBrowser', async (_e, html: string) => {
    const timestamp = Date.now()
    const filename = `bde-playground-${timestamp}.html`
    const filepath = join(tmpdir(), filename)
    writeFileSync(filepath, html, 'utf-8')
    await shell.openPath(filepath)
    return filepath
  })
}
