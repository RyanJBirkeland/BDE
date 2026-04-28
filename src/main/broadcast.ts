/**
 * Broadcast — sends push events from main process to all renderer windows.
 * Service-layer code calls broadcast() instead of importing BrowserWindow directly.
 */
import { BrowserWindow } from 'electron'
import type { BroadcastChannels } from '../shared/ipc-channels/broadcast-channels'

export function broadcast<K extends keyof BroadcastChannels>(
  channel: K,
  ...args: BroadcastChannels[K] extends void ? [] : [data: BroadcastChannels[K]]
): void {
  const data = args[0]
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}

/**
 * Coalesced broadcast — batches rapid events into a single IPC send per window.
 * Uses a 16ms timer to collect events from the same tick and broadcasts them
 * as an array to reduce IPC overhead when multiple agents emit terminal events.
 *
 * Exported as a class so tests can construct isolated instances without
 * module-reload tricks. The module-level `_coalesced` singleton preserves all
 * existing call sites.
 */
export class CoalescedBroadcaster {
  private readonly pending = new Map<string, unknown[]>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  send<K extends keyof BroadcastChannels>(channel: K, payload: BroadcastChannels[K]): void {
    const arr = this.pending.get(channel) ?? []
    arr.push(payload)
    this.pending.set(channel, arr)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 16)
    }
  }

  private flush(): void {
    this.flushTimer = null
    for (const [channel, payloads] of this.pending) {
      this.pending.delete(channel)
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(channel + ':batch', payloads)
        }
      }
    }
  }
}

const _coalesced = new CoalescedBroadcaster()

export function broadcastCoalesced<K extends keyof BroadcastChannels>(
  channel: K,
  payload: BroadcastChannels[K]
): void {
  _coalesced.send(channel, payload)
}
