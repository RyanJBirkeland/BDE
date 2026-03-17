/**
 * Singleton SSE client for task-runner events.
 * Subscribes to the existing IPC bridge (sprint:sse-event) that the main
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
  id: string
  [key: string]: unknown
}

// --- Singleton ---

type Handler = (data: unknown) => void

const listeners = new Map<string, Set<Handler>>()
let connected = false

function connect(): void {
  if (connected) return
  window.api.offSprintSseEvent()
  connected = true
  window.api.onSprintSseEvent((event: { type: string; data: unknown }) => {
    emit(event.type, event.data)
  })
}

function emit(event: string, data: unknown): void {
  listeners.get(event)?.forEach((fn) => fn(data))
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
