import { ipcMain } from 'electron'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeHandle(
  channel: string,
  handler: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => any
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
