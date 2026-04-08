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

/**
 * Coalesced broadcast — batches rapid events into a single IPC send per window.
 * Uses a 16ms timer to collect events from the same tick and broadcasts them
 * as an array to reduce IPC overhead when multiple agents emit terminal events.
 */

const _pending = new Map<string, unknown[]>()
let _flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  _flushTimer = null
  for (const [channel, payloads] of _pending) {
    _pending.delete(channel)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel + ':batch', payloads)
      }
    }
  }
}

export function broadcastCoalesced(channel: string, payload: unknown): void {
  const arr = _pending.get(channel) ?? []
  arr.push(payload)
  _pending.set(channel, arr)
  if (!_flushTimer) {
    _flushTimer = setTimeout(flush, 16)
  }
}
