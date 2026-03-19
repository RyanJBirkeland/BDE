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
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await handler(e, ...(args as IpcChannelMap[K]['args']))
    } catch (err) {
      console.error(`[IPC:${channel}] unhandled error:`, err)
      throw err
    }
  })
}
