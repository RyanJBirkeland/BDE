import { ipcMain } from 'electron'
import type { IpcChannelMap } from '../shared/ipc-channels'

/**
 * Type-safe IPC handler for channels defined in IpcChannelMap.
 * Channel name typos and payload mismatches are caught at compile time.
 */
export function safeHandle<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (
    e: Electron.IpcMainInvokeEvent,
    ...args: IpcChannelMap[K]['args']
  ) => IpcChannelMap[K]['result'] | Promise<IpcChannelMap[K]['result']>
): void
/**
 * Untyped overload for channels not yet in IpcChannelMap.
 * TODO: AX-S1 — migrate remaining channels into IpcChannelMap and remove this overload.
 */
export function safeHandle<TArgs extends unknown[] = unknown[]>(
  channel: string,
  handler: (e: Electron.IpcMainInvokeEvent, ...args: TArgs) => unknown
): void
export function safeHandle(
  channel: string,
  handler: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await handler(e, ...args)
    } catch (err) {
      console.error(`[IPC:${channel}] unhandled error:`, err)
      throw err
    }
  })
}
