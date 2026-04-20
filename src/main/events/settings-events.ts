/**
 * Local, in-process event bus for settings-change notifications. The config
 * handlers emit here so main-process modules (e.g., the MCP server) can hot-
 * toggle in response without requiring a renderer broadcast round-trip.
 */
import { EventEmitter } from 'node:events'

export interface SettingChangedEvent {
  key: string
  value: string | null
}

const emitter = new EventEmitter()
emitter.setMaxListeners(32)

export function emitSettingChanged(event: SettingChangedEvent): void {
  emitter.emit('setting-changed', event)
}

export function onSettingChanged(listener: (event: SettingChangedEvent) => void): () => void {
  emitter.on('setting-changed', listener)
  return () => emitter.off('setting-changed', listener)
}
