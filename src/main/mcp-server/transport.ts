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
 *   3. Bearer token auth (with brute-force throttling on repeated failures).
 *   4. Request body size cap — enforced by buffering the body ourselves
 *      (capped by `MAX_BODY_BYTES`) and handing it to the SDK as
 *      `parsedBody`, so the SDK never re-reads the stream.
 * The SDK then applies DNS-rebinding (Host) and Origin validation.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { checkBearerAuth, type AuthResult } from './auth'
import { createAuthRateLimit, type AuthRateLimit } from './auth-rate-limit'
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
const UNKNOWN_REMOTE = 'unknown'

interface Closable {
  close: () => Promise<void>
}

type BodyReadResult =
  | { ok: true; parsed: unknown }
  | { ok: false; status: 413 | 400; code: number; message: string }

interface RequestScope {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

/**
 * `rateLimit` is optional so tests and alternate composition roots can opt
 * out. When omitted, the handler instantiates its own per-handler rate
 * limit so production callers get throttling without having to wire it up
 * explicitly — the composition root can still inject a shared instance if
 * it wants cross-handler visibility.
 */
export function createTransportHandler(
  buildMcpServer: () => McpServer,
  token: string,
  port: number,
  logger: Logger,
  rateLimit: AuthRateLimit = createAuthRateLimit({ logger })
): TransportHandler {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!enforceRoute(req, res, logger)) return
    const denial = checkAuthorization(req, token, rateLimit, logger)
    if (denial) {
      await rejectUnauthorized(res, denial)
      return
    }
    const body = await readBoundedBody(req, res, logger)
    if (!body.ok) return
    const scope = buildRequestScope(buildMcpServer, port)
    await dispatch(req, res, scope, body.parsed, logger)
  }

  return {
    handle,
    async close() {
      // Nothing to close — stateless mode creates no persistent resources.
    }
  }
}

/**
 * URL + method allow-list. Returns `true` when the request should proceed;
 * returns `false` and writes a terminal response when it should not.
 */
function enforceRoute(req: IncomingMessage, res: ServerResponse, logger: Logger): boolean {
  if (req.url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return false
  }
  if (req.method !== ALLOWED_METHOD) {
    writeMethodNotAllowed(res, logger)
    return false
  }
  return true
}

interface AuthDenial {
  auth: Extract<AuthResult, { ok: false }>
  delayMs: number
}

/**
 * Synchronous bearer-token check with brute-force bookkeeping. On success,
 * clears any prior failure count for this remote and returns `null` so
 * the caller can proceed without awaiting anything (important — awaiting a
 * synchronously-resolved promise yields a microtask, during which the
 * request body stream can fire 'end' before listeners are attached).
 * On failure, logs structured context and returns an `AuthDenial` the
 * caller passes to `rejectUnauthorized` to apply the delay and write the
 * 401 response.
 */
function checkAuthorization(
  req: IncomingMessage,
  token: string,
  rateLimit: AuthRateLimit,
  logger: Logger
): AuthDenial | null {
  const remoteAddress = remoteAddressOf(req)
  const auth = checkBearerAuth(req, token)
  if (auth.ok) {
    rateLimit.recordAuthSuccess(remoteAddress)
    return null
  }
  logger.warn(`mcp.auth.failure: ${auth.message} from ${remoteAddress}`)
  const delayMs = rateLimit.recordAuthFailure(remoteAddress)
  return { auth, delayMs }
}

/**
 * Applies the brute-force back-off delay (if any) and then writes the 401
 * envelope. Delay-before-response intentionally happens here so clients
 * under throttling feel the slowdown before they can retry.
 */
async function rejectUnauthorized(res: ServerResponse, denial: AuthDenial): Promise<void> {
  if (denial.delayMs > 0) await sleep(denial.delayMs)
  res.writeHead(denial.auth.status, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer realm="bde-mcp"'
  })
  const body = {
    jsonrpc: '2.0' as const,
    id: null,
    error: { code: JSON_RPC_UNAUTHORIZED, message: denial.auth.message }
  }
  res.end(JSON.stringify(body))
}

/**
 * Buffers the request body with a 2 MB cap and parses it as JSON. On
 * rejection writes the appropriate 4xx response and returns `{ ok: false }`
 * so the caller can bail. On success returns the parsed value for
 * forwarding to the SDK as `parsedBody`.
 */
async function readBoundedBody(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger
): Promise<{ ok: true; parsed: unknown } | { ok: false }> {
  if (exceedsDeclaredBodyCap(req)) {
    writePayloadTooLarge(res, logger)
    return { ok: false }
  }
  const bodyResult = await readJsonBodyWithCap(req)
  if (!bodyResult.ok) {
    logger.warn(`mcp.transport.body-rejected: ${bodyResult.message}`)
    writeJsonRpcEnvelope(res, bodyResult.status, bodyResult.code, bodyResult.message)
    return { ok: false }
  }
  return { ok: true, parsed: bodyResult.parsed }
}

/**
 * Each MCP request requires its own fresh SDK pair — the stateless
 * transport cannot be reused. This helper bundles the pair so the rest of
 * the handler can treat it as a single scope value.
 */
function buildRequestScope(buildMcpServer: () => McpServer, port: number): RequestScope {
  const server = buildMcpServer()
  // SDK type lies about `sessionIdGenerator` — it marks it as `() => string` in
  // the input type but the stateless path requires explicit `undefined` at
  // runtime. See @modelcontextprotocol/sdk: StreamableHTTPServerTransport.
  const transportOptions = {
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: ['127.0.0.1', 'localhost', `127.0.0.1:${port}`, `localhost:${port}`],
    allowedOrigins: allowedOriginsFor(port)
  } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]
  const transport = new StreamableHTTPServerTransport(transportOptions)
  return { server, transport }
}

/**
 * Hand the request off to the SDK and register a cleanup hook for the
 * response-close event. Any unhandled failure inside the SDK (including
 * `server.connect`) is logged and surfaced as a JSON-RPC 500.
 */
async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  scope: RequestScope,
  parsedBody: unknown,
  logger: Logger
): Promise<void> {
  try {
    // SDK's Transport interface types `onclose` as `() => void` but the concrete
    // `StreamableHTTPServerTransport` exposes it as `(() => void) | undefined`.
    // The assignment is safe — the SDK itself handles the undefined case.
    await scope.server.connect(scope.transport as Parameters<typeof scope.server.connect>[0])
    await scope.transport.handleRequest(req, res, parsedBody)
    scheduleCleanup(res, scope, logger)
  } catch (err) {
    logger.error(formatRequestErrorLine('mcp.transport.500', req, err))
    writeJsonRpcError(res, 500, err, { logger })
  }
}

/**
 * On response-close, race `transport.close()` and `server.close()` against
 * a 5 s timeout so a stuck close can never leak the underlying resources.
 */
function scheduleCleanup(res: ServerResponse, scope: RequestScope, logger: Logger): void {
  res.on('close', () => {
    closeWithTimeout('transport', scope.transport, logger)
    closeWithTimeout('mcp server', scope.server, logger)
  })
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
  logger.warn(`mcp.transport.method-not-allowed: ${message}`)
  res.setHeader('Allow', ALLOWED_METHOD)
  writeJsonRpcEnvelope(res, 405, JSON_RPC_INVALID_REQUEST, message)
}

function writePayloadTooLarge(res: ServerResponse, logger: Logger): void {
  const message = `Request body exceeds ${MAX_BODY_BYTES}-byte limit`
  logger.warn(`mcp.transport.payload-too-large: ${message}`)
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
    logger.warn(`mcp.transport.cleanup: ${label} close timeout or failure — ${formatError(err)}`)
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

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}

function formatRequestErrorLine(prefix: string, req: IncomingMessage, err: unknown): string {
  const method = req.method ?? '?'
  const url = req.url ?? '?'
  const remote = remoteAddressOf(req)
  return `${prefix}: method=${method} url=${url} remote=${remote} — ${formatError(err)}`
}

function remoteAddressOf(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? UNKNOWN_REMOTE
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
