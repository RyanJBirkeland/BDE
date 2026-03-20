/**
 * SSE (Server-Sent Events) client management for the TaskQueueAPI.
 * Broadcasts task mutations to connected task runners.
 */
import type { ServerResponse } from 'http'
import { onSprintMutation } from '../handlers/sprint-listeners'
import type { SprintTask } from '../../shared/types'

const HEARTBEAT_INTERVAL_MS = 30_000

const clients = new Set<ServerResponse>()
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null

function sendEvent(res: ServerResponse, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    // Client may have disconnected — remove it
    clients.delete(res)
  }
}

function broadcast(event: string, data: unknown): void {
  for (const client of clients) {
    sendEvent(client, event, data)
  }
}

function handleMutation(mutation: {
  type: 'created' | 'updated' | 'deleted'
  task: SprintTask
}): void {
  const { type, task } = mutation

  if (type === 'created' && task.status === 'queued') {
    broadcast('task:queued', { id: task.id, title: task.title, priority: task.priority })
  } else if (type === 'updated' && task.status === 'queued') {
    broadcast('task:queued', { id: task.id, title: task.title, priority: task.priority })
  } else if (type === 'updated') {
    broadcast('task:updated', {
      id: task.id,
      status: task.status,
      claimed_by: task.claimed_by,
    })
  } else if (type === 'deleted') {
    broadcast('task:updated', { id: task.id, status: 'deleted' })
  }
}

export function addSseClient(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  // Send initial heartbeat so client knows connection is alive
  sendEvent(res, 'heartbeat', {})

  clients.add(res)

  res.on('close', () => {
    clients.delete(res)
  })
}

export function startSseBroadcaster(): void {
  unsubscribe = onSprintMutation(handleMutation)

  heartbeatTimer = setInterval(() => {
    broadcast('heartbeat', {})
  }, HEARTBEAT_INTERVAL_MS)
}

export function getSseClientCount(): number {
  return clients.size
}

export function stopSseBroadcaster(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  // Notify clients of shutdown and close connections
  for (const client of clients) {
    try {
      sendEvent(client, 'shutdown', {})
      client.end()
    } catch {
      // Ignore errors during shutdown
    }
  }
  clients.clear()
}
