import { ipcMain } from 'electron'
import type { IpcChannelMap } from '../shared/ipc-channels'
import { createLogger } from './logger'

const logger = createLogger('ipc')

/**
 * Optional runtime-validation hook for an IPC channel's arguments.
 * Runs before the handler is dispatched; throws to reject the payload.
 * The return value replaces the args passed to the handler, letting a
 * parser normalize or narrow the input.
 */
export type IpcArgsParser<K extends keyof IpcChannelMap> = (
  args: unknown[]
) => IpcChannelMap[K]['args']

/**
 * Type-safe IPC handler for channels defined in IpcChannelMap.
 * Channel name typos and payload mismatches are caught at compile time.
 * Pass `parseArgs` to add a runtime shape check on top of the static types.
 */
export function safeHandle<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (
    e: Electron.IpcMainInvokeEvent,
    ...args: IpcChannelMap[K]['args']
  ) => IpcChannelMap[K]['result'] | Promise<IpcChannelMap[K]['result']>,
  parseArgs?: IpcArgsParser<K>
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      const parsedArgs = parseArgs ? runParser(channel, parseArgs, args) : args
      return await handler(e, ...(parsedArgs as IpcChannelMap[K]['args']))
    } catch (err) {
      logger.error(`[${channel}] unhandled error: ${err}`)
      throw err
    }
  })
}

/**
 * Type-safe IPC event listener for fire-and-forget channels.
 * Use this for one-way messages (ipcRenderer.send) instead of safeHandle (invoke/handle).
 * Pass `parseArgs` to reject malformed payloads; violations are logged and the handler is skipped.
 */
export function safeOn<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (e: Electron.IpcMainEvent, ...args: IpcChannelMap[K]['args']) => void,
  parseArgs?: IpcArgsParser<K>
): void {
  ipcMain.on(channel, (e, ...args) => {
    try {
      const parsedArgs = parseArgs ? runParser(channel, parseArgs, args) : args
      handler(e, ...(parsedArgs as IpcChannelMap[K]['args']))
    } catch (err) {
      logger.error(`[${channel}] unhandled error: ${err}`)
    }
  })
}

function runParser<K extends keyof IpcChannelMap>(
  channel: K,
  parseArgs: IpcArgsParser<K>,
  args: unknown[]
): IpcChannelMap[K]['args'] {
  try {
    return parseArgs(args)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(`[${channel}] invalid payload: ${reason}`)
    throw err
  }
}
