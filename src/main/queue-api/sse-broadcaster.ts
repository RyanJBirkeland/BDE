// src/main/queue-api/sse-broadcaster.ts
import type { ServerResponse } from 'node:http'
import { CORS_HEADERS } from './helpers'

export interface SseBroadcaster {
  addClient(res: ServerResponse): void
  removeClient(res: ServerResponse): void
  broadcast(event: string, data: unknown): void
  clientCount(): number
  close(): void
}

const MAX_SSE_CLIENTS = 100

export function createSseBroadcaster(): SseBroadcaster {
  const clients = new Set<ServerResponse>()
  let heartbeatInterval: NodeJS.Timeout | null = setInterval(() => {
    for (const c of clients) {
      try {
        c.write(':heartbeat\n\n')
      } catch {
        clients.delete(c)
      }
    }
  }, 30_000)

  return {
    addClient(res) {
      // QA-20: Enforce connection limit to prevent resource exhaustion
      if (clients.size >= MAX_SSE_CLIENTS) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Too many SSE connections' }))
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS_HEADERS
      })
      clients.add(res)
      res.on('close', () => clients.delete(res))
      try {
        res.write(':connected\n\n')
      } catch {
        clients.delete(res)
      }
    },
    removeClient(res) {
      clients.delete(res)
    },
    broadcast(event, data) {
      // QA-7: All connected SSE clients receive all events (no per-client filtering).
      // For multi-tenant environments, implement task-level event filtering based on
      // client subscriptions or permissions.
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      for (const c of clients) {
        try {
          c.write(payload)
        } catch {
          clients.delete(c)
        }
      }
    },
    clientCount: () => clients.size,
    close() {
      // QA-22: Clear interval to prevent leak on module reload
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
        heartbeatInterval = null
      }
      for (const c of clients) {
        try {
          c.end()
        } catch {
          /* client already disconnected */
        }
      }
      clients.clear()
    }
  }
}
