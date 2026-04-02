/**
 * Broadcast — sends push events from main process to all renderer windows.
 * Service-layer code calls broadcast() instead of importing BrowserWindow directly.
 */
import { BrowserWindow } from 'electron'

export function broadcast(channel: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
