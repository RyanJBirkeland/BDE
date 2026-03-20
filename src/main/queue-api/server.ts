/**
 * TaskQueueAPI HTTP server.
 * Binds to 127.0.0.1 only (localhost). Port configurable via settings.
 */
import { createServer, type Server } from 'http'
import { getSetting } from '../settings'
import { handleRequest } from './router'
import { startSseBroadcaster, stopSseBroadcaster } from './sse'

const DEFAULT_PORT = 18790

let server: Server | null = null

export function startQueueApi(): void {
  const portSetting = getSetting('taskRunner.queuePort')
  const port = portSetting ? parseInt(portSetting, 10) : DEFAULT_PORT

  const effectivePort =
    isNaN(port) || port < 1 || port > 65535 ? DEFAULT_PORT : port

  if (effectivePort !== port) {
    console.warn(
      `[queue-api] invalid port "${portSetting}", using default ${DEFAULT_PORT}`
    )
  }

  startSseBroadcaster()

  server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[queue-api] unhandled error in request handler:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(
        `[queue-api] port ${effectivePort} is in use — queue API disabled`
      )
    } else {
      console.error('[queue-api] server error:', err)
    }
    server = null
  })

  server.listen(effectivePort, '127.0.0.1', () => {
    console.log(`[queue-api] listening on http://127.0.0.1:${effectivePort}`)
  })
}

export function stopQueueApi(): void {
  stopSseBroadcaster()

  if (server) {
    server.close()
    server = null
  }
}
