/**
 * Singleton SSE client for task-runner events.
 * Subscribes to the existing IPC bridge (sprint:sseEvent) that the main
 * process maintains, and dispatches typed events to renderer components.
 */

// --- Event interfaces ---

export interface LogChunkEvent {
  taskId: string
  agentId: string
  content: string
  fromByte: number
}

export interface LogDoneEvent {
  taskId: string
  agentId: string
  exitCode: number
}

export interface TaskUpdatedEvent {
  taskId: string
  [key: string]: unknown
}

// --- Singleton ---

type Handler = (data: unknown) => void

const listeners = new Map<string, Set<Handler>>()
let connected = false
let cleanupSse: (() => void) | null = null

function connect(): void {
  if (connected) return
  // Clean up previous listener if any
  cleanupSse?.()
  connected = true
  cleanupSse = window.api.onSprintSseEvent((event: { type: string; data: unknown }) => {
    if (event.type === '__sse-disconnected') {
      // Main process signalled that the SSE connection dropped.
      // Reset so the next subscribeSSE (or reconnect) re-registers.
      connected = false
      return
    }
    emit(event.type, event.data)
  })
}

function emit(event: string, data: unknown): void {
  listeners.get(event)?.forEach((fn) => fn(data))
}

/**
 * Tear down the IPC listener and reset connection state so a subsequent
 * `subscribeSSE` call will re-establish the bridge.
 */
export function disconnect(): void {
  cleanupSse?.()
  cleanupSse = null
  connected = false
}

export function subscribeSSE(event: string, handler: Handler): () => void {
  connect()
  if (!listeners.has(event)) listeners.set(event, new Set())
  const set = listeners.get(event)
  if (set) set.add(handler)
  return () => {
    listeners.get(event)?.delete(handler)
  }
}
