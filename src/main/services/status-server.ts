import http from 'node:http'
import type { AgentManager } from '../agent-manager'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { createLogger } from '../logger'
import { nowIso } from '../../shared/time'
import { broadcast } from '../broadcast'

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
 */
export function createStatusServer(
  agentManager: Pick<AgentManager, 'getStatus' | 'getMetrics'>,
  repo: Pick<ISprintTaskRepository, 'getQueueStats'>,
  port = 18791
): StatusServer {
  let server: http.Server | null = null

  function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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
            ? `Status server could not bind to port ${port} — another BDE instance may be running.`
            : `Status server failed to start: ${errMsg}`
          // broadcast is a no-op before any window exists (early bootstrap);
          // the logger still captures the error for triage in that case.
          broadcast('manager:warning', { message })
          reject(err)
        })

        server.listen(port, '127.0.0.1', () => {
          const addr = server!.address()
          const actualPort = typeof addr === 'object' && addr ? addr.port : port
          logger.info(`[status-server] Listening on http://127.0.0.1:${actualPort}/status`)
          resolve(actualPort)
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
