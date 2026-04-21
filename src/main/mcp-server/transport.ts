/**
 * Thin HTTP wrapper around the MCP SDK's Streamable HTTP transport.
 * Adds bearer-token auth, defense-in-depth request gating, and structured
 * error logging before delegating to the SDK's own request handler.
 *
 * The MCP SDK's stateless transport cannot be reused across requests — each
 * HTTP request requires a fresh transport + server instance. We accept a
 * factory so that each inbound request gets its own isolated pair.
 *
 * Defense-in-depth gates (applied before the SDK sees the request):
 *   1. URL allow-list (only `/mcp`).
 *   2. HTTP method allow-list (POST only).
 *   3. Bearer token auth.
 *   4. Request body size cap — enforced by buffering the body ourselves
 *      (capped by `MAX_BODY_BYTES`) and handing it to the SDK as
 *      `parsedBody`, so the SDK never re-reads the stream.
 * The SDK then applies DNS-rebinding (Host) and Origin validation.
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

const ALLOWED_METHOD = 'POST'
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB ceiling for MCP payloads (T-46)
const CLOSE_TIMEOUT_MS = 5_000 // Bound transport/server teardown so stuck closes don't leak (T-47)
const JSON_RPC_INVALID_REQUEST = -32600 // JSON-RPC 2.0 spec: "The JSON sent is not a valid Request."
const JSON_RPC_PARSE_ERROR = -32700 // JSON-RPC 2.0 spec: "Invalid JSON was received by the server."

interface Closable {
  close: () => Promise<void>
}

type BodyReadResult =
  | { ok: true; parsed: unknown }
  | { ok: false; status: 413 | 400; code: number; message: string }

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
      if (req.method !== ALLOWED_METHOD) {
        writeMethodNotAllowed(res, logger)
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
      if (exceedsDeclaredBodyCap(req)) {
        writePayloadTooLarge(res, logger)
        return
      }
      const bodyResult = await readJsonBodyWithCap(req)
      if (!bodyResult.ok) {
        logger.warn(`mcp transport rejected body: ${bodyResult.message}`)
        writeJsonRpcEnvelope(res, bodyResult.status, bodyResult.code, bodyResult.message)
        return
      }

      const server = buildMcpServer()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: true,
        allowedHosts: ['127.0.0.1', 'localhost', `127.0.0.1:${port}`, `localhost:${port}`],
        allowedOrigins: allowedOriginsFor(port)
      })
      try {
        await server.connect(transport)
        await transport.handleRequest(req, res, bodyResult.parsed)
        res.on('close', () => {
          closeWithTimeout('transport', transport, logger)
          closeWithTimeout('mcp server', server, logger)
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

/**
 * Explicit Origin allow-list — replaces the SDK's "disabled when empty"
 * behavior so a future CORS change can't silently accept foreign origins.
 * MCP clients typically send no Origin header; the SDK only enforces when
 * the header is present.
 */
function allowedOriginsFor(port: number): string[] {
  return [
    'null', // file:// and sandboxed contexts emit "Origin: null"
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`
  ]
}

function writeMethodNotAllowed(res: ServerResponse, logger: Logger): void {
  const message = `Only ${ALLOWED_METHOD} is allowed on /mcp`
  logger.warn(`mcp transport method not allowed: ${message}`)
  res.setHeader('Allow', ALLOWED_METHOD)
  writeJsonRpcEnvelope(res, 405, JSON_RPC_INVALID_REQUEST, message)
}

function writePayloadTooLarge(res: ServerResponse, logger: Logger): void {
  const message = `Request body exceeds ${MAX_BODY_BYTES}-byte limit`
  logger.warn(`mcp transport payload too large: ${message}`)
  writeJsonRpcEnvelope(res, 413, JSON_RPC_INVALID_REQUEST, message)
}

function writeJsonRpcEnvelope(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
  }
  const body = {
    jsonrpc: '2.0' as const,
    id: null,
    error: { code, message }
  }
  res.end(JSON.stringify(body))
}

/**
 * Returns true when the declared Content-Length already exceeds the cap,
 * letting us reject oversized requests without reading any body bytes.
 * Missing or malformed headers fall through to streamed enforcement.
 */
function exceedsDeclaredBodyCap(req: IncomingMessage): boolean {
  const header = req.headers['content-length']
  if (typeof header !== 'string') return false
  const declared = Number.parseInt(header, 10)
  if (!Number.isFinite(declared)) return false
  return declared > MAX_BODY_BYTES
}

/**
 * Buffers the request body in memory up to `MAX_BODY_BYTES`, returning 413
 * when cumulative bytes exceed the cap (defends against spoofed or absent
 * Content-Length) or 400 when the buffered bytes are not valid JSON.
 * The parsed value is forwarded to the SDK as `parsedBody` so the SDK does
 * not re-consume the stream.
 */
function readJsonBodyWithCap(req: IncomingMessage): Promise<BodyReadResult> {
  return new Promise<BodyReadResult>((resolve) => {
    const chunks: Buffer[] = []
    let bytesSeen = 0
    let settled = false

    const settle = (result: BodyReadResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    req.on('data', (chunk: Buffer) => {
      bytesSeen += chunk.length
      if (bytesSeen > MAX_BODY_BYTES) {
        req.destroy()
        settle({
          ok: false,
          status: 413,
          code: JSON_RPC_INVALID_REQUEST,
          message: `Request body exceeds ${MAX_BODY_BYTES}-byte limit`
        })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) {
        settle({ ok: true, parsed: undefined })
        return
      }
      try {
        settle({ ok: true, parsed: JSON.parse(raw) })
      } catch (err) {
        settle({
          ok: false,
          status: 400,
          code: JSON_RPC_PARSE_ERROR,
          message: `Parse error: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    })
    req.on('error', (err) => {
      settle({
        ok: false,
        status: 400,
        code: JSON_RPC_PARSE_ERROR,
        message: `Request stream error: ${err.message}`
      })
    })
  })
}

/**
 * Bounds `closable.close()` so a stuck close doesn't leak the underlying
 * resource. Logs a structured warning (with stack when available) on both
 * timeouts and close failures — template-stringifying an unknown throw
 * would lose the stack.
 */
function closeWithTimeout(label: string, closable: Closable, logger: Logger): void {
  withTimeout(closable.close(), CLOSE_TIMEOUT_MS, label).catch((err) => {
    logger.warn(`${label} close timeout or failure: ${formatTransportError(err)}`)
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} close timed out after ${ms}ms`)), ms)
    )
  ])
}

function formatTransportError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}
