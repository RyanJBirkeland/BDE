import { ipcMain } from 'electron'

export function safeHandle<TArgs extends unknown[] = unknown[]>(
  channel: string,
  handler: (e: Electron.IpcMainInvokeEvent, ...args: TArgs) => unknown
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await handler(e, ...(args as TArgs))
    } catch (err) {
      console.error(`[IPC:${channel}] unhandled error:`, err)
      throw err
    }
  })
}
