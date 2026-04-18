/**
 * Thin HTTP wrapper around the MCP SDK's Streamable HTTP transport.
 * Adds bearer-token auth and structured error logging before delegating
 * to the SDK's own request handler.
 *
 * The MCP SDK's stateless transport cannot be reused across requests — each
 * HTTP request requires a fresh transport + server instance. We accept a
 * factory so that each inbound request gets its own isolated pair.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { checkBearerAuth } from './auth'
import type { Logger } from '../logger'

export interface TransportHandler {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  close: () => Promise<void>
}

export function createTransportHandler(
  buildMcpServer: () => McpServer,
  token: string,
  logger: Logger
): TransportHandler {
  return {
    async handle(req, res) {
      if (req.url !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }
      const auth = checkBearerAuth(req, token)
      if (!auth.ok) {
        res.writeHead(auth.status, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="bde-mcp"'
        })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: auth.message } }))
        return
      }

      const server = buildMcpServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      try {
        await server.connect(transport)
        await transport.handleRequest(req, res)
        res.on('close', () => {
          transport.close().catch((err) => logger.warn(`transport close: ${err}`))
          server.close().catch((err) => logger.warn(`server close: ${err}`))
        })
      } catch (err) {
        logger.error(`mcp transport: ${err}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal error' }))
        }
      }
    },
    async close() {
      // Nothing to close — stateless mode creates no persistent resources.
    }
  }
}
