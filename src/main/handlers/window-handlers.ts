import { BrowserWindow, shell } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { safeHandle, safeOn } from '../ipc-utils'
import { sanitizePlaygroundHtml } from '../playground-sanitize'

const ALLOWED_URL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

/** How long (ms) to keep the temp HTML file before auto-deleting it. */
const PLAYGROUND_TEMP_FILE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function registerWindowHandlers(): void {
  safeHandle('window:openExternal', (_e, url) => {
    const parsed = new URL(url)
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Blocked URL scheme: "${parsed.protocol}"`)
    }
    return shell.openExternal(url)
  })

  safeOn('window:setTitle', (_e, title: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && typeof title === 'string') win.setTitle(title)
  })

  safeHandle('playground:sanitize', (_e, html: string) => {
    return sanitizePlaygroundHtml(html)
  })

  safeHandle('playground:openInBrowser', async (_e, html: string) => {
    // Re-sanitize before writing — renderer HTML may differ from the original
    // sanitized version (e.g. user edits in source view). Use a cryptographically
    // random filename to prevent predictable-path timing attacks.
    const cleanHtml = sanitizePlaygroundHtml(html)
    const filename = `fleet-playground-${randomBytes(16).toString('hex')}.html`
    const filepath = join(tmpdir(), filename)
    writeFileSync(filepath, cleanHtml, 'utf-8')
    await shell.openPath(filepath)
    // Schedule cleanup — temp file is only needed until the browser opens it
    setTimeout(() => {
      try {
        unlinkSync(filepath)
      } catch {
        // File may already be gone; ignore
      }
    }, PLAYGROUND_TEMP_FILE_TTL_MS)
    return filepath
  })
}
