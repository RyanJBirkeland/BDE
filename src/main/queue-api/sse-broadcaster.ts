// src/main/queue-api/sse-broadcaster.ts
import type { ServerResponse } from 'node:http'

export interface SseBroadcaster {
  addClient(res: ServerResponse): void
  removeClient(res: ServerResponse): void
  broadcast(event: string, data: unknown): void
  clientCount(): number
  close(): void
}

export function createSseBroadcaster(): SseBroadcaster {
  const clients = new Set<ServerResponse>()
  const heartbeat = setInterval(() => {
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
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
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
      clearInterval(heartbeat)
      for (const c of clients) {
        try {
          c.end()
        } catch {}
      }
      clients.clear()
    }
  }
}
