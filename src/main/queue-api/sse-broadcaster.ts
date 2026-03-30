// src/main/queue-api/sse-broadcaster.ts
import type { ServerResponse } from 'node:http'
import { CORS_HEADERS } from './helpers'

// QA-7: Client metadata for filtering
interface ClientInfo {
  res: ServerResponse
  taskFilter?: string // If set, only broadcast events for this task
}

export interface SseBroadcaster {
  addClient(res: ServerResponse, taskFilter?: string): void
  removeClient(res: ServerResponse): void
  broadcast(event: string, data: unknown): void
  clientCount(): number
  close(): void
}

export function createSseBroadcaster(): SseBroadcaster {
  const clients = new Map<ServerResponse, ClientInfo>()
  const heartbeat = setInterval(() => {
    for (const [res] of clients) {
      try {
        res.write(':heartbeat\n\n')
      } catch {
        clients.delete(res)
      }
    }
  }, 30_000)

  return {
    addClient(res, taskFilter) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS_HEADERS
      })
      // QA-7: Store client with optional task filter
      clients.set(res, { res, taskFilter })
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
      const dataObj = data as Record<string, unknown>
      const taskId = dataObj?.taskId as string | undefined

      // QA-7: Filter broadcasts based on client task subscriptions
      for (const [res, clientInfo] of clients) {
        // If client has a task filter, only send events for that task
        if (clientInfo.taskFilter && taskId && clientInfo.taskFilter !== taskId) {
          continue
        }
        try {
          res.write(payload)
        } catch {
          clients.delete(res)
        }
      }
    },
    clientCount: () => clients.size,
    close() {
      clearInterval(heartbeat)
      for (const [res] of clients) {
        try {
          res.end()
        } catch {}
      }
      clients.clear()
    }
  }
}
