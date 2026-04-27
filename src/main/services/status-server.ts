import http from 'node:http'
import type { AgentManagerStatusReader } from './ports/agent-manager-status'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { createLogger } from '../logger'
import { nowIso } from '../../shared/time'

const logger = createLogger('status-server')

export interface StatusServer {
  start(): Promise<number>
  stop(): void
}

/**
 * Creates a minimal HTTP server for read-only monitoring of agent manager status.
 * Separate from the removed Queue API — this is GET-only and returns JSON status.
 *
 * @param agentManager - Agent manager instance to query for status/metrics
 * @param repo - Sprint task repository for queue statistics
 * @param port - Port to listen on (default 18791, use 0 for random port in tests)
 * @param token - Optional bearer token; when provided, all requests must carry it
 * @param broadcast - Optional IPC broadcast function; called with manager:warning on bind errors
 */
export function createStatusServer(
  agentManager: AgentManagerStatusReader,
  repo: Pick<ISprintTaskRepository, 'getQueueStats'>,
  port = 18791,
  token?: string,
  broadcast?: (channel: string, payload?: Record<string, unknown>) => void
): StatusServer {
  let server: http.Server | null = null
  // Updated after bind so the Host check uses the real port (important when port=0).
  let boundPort = port

  function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Host header check — reject requests that spoof a different Host
    const host = req.headers['host']
    if (host && host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid Host header' }))
      return
    }

    // Bearer token check
    if (token) {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
    }

    // Only handle GET /status
    if (req.url === '/status') {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      try {
        const status = agentManager.getStatus()
        const metrics = agentManager.getMetrics()
        const queue = repo.getQueueStats()

        const body = JSON.stringify({
          agentManager: status,
          metrics,
          queue,
          ts: nowIso()
        })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body)
      } catch (err) {
        logger.error(`[status-server] Error generating status: ${err}`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    } else {
      // Unknown path
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  }

  return {
    start(): Promise<number> {
      return new Promise((resolve, reject) => {
        if (server) {
          server.close()
          server = null
        }

        server = http.createServer(handleRequest)

        server.on('error', (err) => {
          logger.error(`[status-server] Server error: ${err}`)
          const errMsg = err instanceof Error ? err.message : String(err)
          const isAddrInUse =
            (err as NodeJS.ErrnoException).code === 'EADDRINUSE' || errMsg.includes('EADDRINUSE')
          const message = isAddrInUse
            ? `Status server could not bind to port ${port} — another FLEET instance may be running.`
            : `Status server failed to start: ${errMsg}`
          // broadcast is a no-op before any window exists (early bootstrap);
          // the logger still captures the error for triage in that case.
          broadcast?.('manager:warning', { message })
          reject(err)
        })

        server.listen(port, '127.0.0.1', () => {
          const addr = server!.address()
          boundPort = typeof addr === 'object' && addr ? addr.port : port
          logger.info(`[status-server] Listening on http://127.0.0.1:${boundPort}/status`)
          resolve(boundPort)
        })
      })
    },

    stop(): void {
      if (server) {
        server.close()
        server = null
        logger.info('[status-server] Stopped')
      }
    }
  }
}
