/**
 * Queue API HTTP server — lightweight Supabase proxy on port 18790.
 * Allows external runners (without Supabase credentials) to consume
 * the sprint task queue via a simple REST interface.
 */
import http from 'node:http'
import { route } from './router'
import { createLogger } from '../logger'

const logger = createLogger('queue-api')

export interface QueueApiOptions {
  port?: number
  host?: string
}

let server: http.Server | null = null

export function startQueueApi(opts: QueueApiOptions = {}): http.Server {
  const port = opts.port ?? 18790
  const host = opts.host ?? '127.0.0.1'

  if (server) {
    logger.warn('Server already running — skipping start')
    return server
  }

  server = http.createServer(async (req, res) => {
    try {
      await route(req, res)
    } catch (err) {
      logger.error(`Unhandled error: ${err}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    }
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use — Queue API not started. Is another BDE instance running?`)
    } else {
      logger.error(`Queue API server error: ${err.message}`)
    }
    server = null
  })

  server.listen(port, host, () => {
    logger.info(`Listening on http://${host}:${port}`)
  })

  return server
}

export function stopQueueApi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve()
      return
    }
    // closeAllConnections() destroys keep-alive and SSE connections so that
    // server.close() can complete without waiting for them to idle out.
    server.closeAllConnections()
    server.close((err) => {
      server = null
      if (err) reject(err)
      else resolve()
    })
  })
}
