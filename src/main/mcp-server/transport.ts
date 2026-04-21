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
import { JSON_RPC_UNAUTHORIZED, writeJsonRpcError } from './errors'
import type { Logger } from '../logger'

export interface TransportHandler {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  close: () => Promise<void>
}

export function createTransportHandler(
  buildMcpServer: () => McpServer,
  token: string,
  port: number,
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
        const body = {
          jsonrpc: '2.0' as const,
          id: null,
          error: { code: JSON_RPC_UNAUTHORIZED, message: auth.message }
        }
        res.end(JSON.stringify(body))
        return
      }

      const server = buildMcpServer()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: true,
        allowedHosts: ['127.0.0.1', 'localhost', `127.0.0.1:${port}`, `localhost:${port}`],
        allowedOrigins: []
      })
      try {
        await server.connect(transport)
        await transport.handleRequest(req, res)
        res.on('close', () => {
          transport.close().catch((err) => logger.warn(`transport close: ${err}`))
          server.close().catch((err) => logger.warn(`server close: ${err}`))
        })
      } catch (err) {
        logger.error(
          `mcp transport failure: ${req.method ?? '?'} ${req.url ?? '?'} — ${formatTransportError(err)}`
        )
        writeJsonRpcError(res, 500, err, { logger })
      }
    },
    async close() {
      // Nothing to close — stateless mode creates no persistent resources.
    }
  }
}

function formatTransportError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}
