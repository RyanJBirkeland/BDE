import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcChannelMap } from '../shared/ipc-channels'
import type { BroadcastChannels } from '../shared/ipc-channels/broadcast-channels'

/**
 * Creates a typed broadcast subscription for a one-way main→renderer channel.
 * Registers via ipcRenderer.on and returns an unsubscribe function for cleanup.
 */
export function onBroadcast<T>(channel: string) {
  return (callback: (payload: T) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: T): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

/**
 * Type-safe invoke for channels in IpcChannelMap.
 * Channel name typos and payload mismatches are caught at compile time.
 */
export function typedInvoke<K extends keyof IpcChannelMap>(
  channel: K,
  ...args: IpcChannelMap[K]['args']
): Promise<IpcChannelMap[K]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

export type { BroadcastChannels }
