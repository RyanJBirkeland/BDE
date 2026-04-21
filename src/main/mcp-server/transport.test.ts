/**
 * Unit tests for BDE's MCP transport wrapper.
 *
 * The wrapper (`createTransportHandler`) is responsible for three things:
 *   1. Rejecting requests with the wrong URL path or missing/invalid bearer token
 *      before they reach the SDK.
 *   2. Delegating authorized requests to the SDK's
 *      `StreamableHTTPServerTransport`, which performs DNS-rebinding protection.
 *   3. Cleaning up the transport and server instances when the response closes.
 *
 * To keep these tests hermetic, the SDK transport is mocked at module scope
 * via `vi.mock` — each test inspects a captured `MockTransport` instance to
 * assert delegation happened (or didn't). The DNS-rebinding rejection test
 * is the lone exception: it spins up a real `http.Server` and sends a
 * foreign-Host request over a loopback socket so the SDK's real 403 path is
 * exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http, { IncomingMessage, ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { createTransportHandler } from './transport'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Logger } from '../logger'

interface MockTransport {
  handleRequest: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  constructorOptions: { allowedOrigins?: string[]; allowedHosts?: string[] } & Record<
    string,
    unknown
  >
}

const transportInstances: MockTransport[] = []

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  return {
    StreamableHTTPServerTransport: vi.fn(function (
      this: MockTransport,
      options: MockTransport['constructorOptions']
    ) {
      this.handleRequest = vi.fn().mockResolvedValue(undefined)
      this.close = vi.fn().mockResolvedValue(undefined)
      this.constructorOptions = options
      transportInstances.push(this)
    })
  }
})

function latestMockTransport(): MockTransport {
  const last = transportInstances.at(-1)
  if (!last) throw new Error('No mock transport has been constructed yet')
  return last
}

interface MockRequestOverrides {
  url?: string
  method?: string
  headers?: Record<string, string>
}

interface MockRequestHandle {
  req: IncomingMessage
  emitData: (chunk: Buffer) => void
  emitEnd: () => void
  emitError: (err: Error) => void
  destroy: ReturnType<typeof vi.fn>
}

/**
 * Builds a mock IncomingMessage whose stream events (`data`, `end`,
 * `error`) can be driven by the test. With `autoEnd: true` (the default)
 * the mock schedules an empty-body `end` on the next microtask so handlers
 * that read the body can progress without each test wiring stream
 * lifecycle. Tests that want to simulate overflow or partial bodies pass
 * `autoEnd: false` and drive the stream themselves.
 */
function createMockRequest(
  overrides: MockRequestOverrides = {},
  options: { autoEnd?: boolean; autoEndBody?: string } = { autoEnd: true }
): MockRequestHandle {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  const destroy = vi.fn()
  const req = {
    url: '/mcp',
    headers: {},
    method: 'POST',
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      ;(listeners[event] ||= []).push(listener)
      return req
    }),
    destroy,
    ...overrides
  } as unknown as IncomingMessage
  const handle: MockRequestHandle = {
    req,
    emitData: (chunk: Buffer) => {
      for (const listener of listeners['data'] ?? []) listener(chunk)
    },
    emitEnd: () => {
      for (const listener of listeners['end'] ?? []) listener()
    },
    emitError: (err: Error) => {
      for (const listener of listeners['error'] ?? []) listener(err)
    },
    destroy
  }
  if (options.autoEnd) {
    queueMicrotask(() => {
      if (options.autoEndBody) {
        handle.emitData(Buffer.from(options.autoEndBody, 'utf8'))
      }
      handle.emitEnd()
    })
  }
  return handle
}

interface MockResponse {
  res: ServerResponse
  written: { status: number; headers: Record<string, string>; body: string }
}

function createMockResponse(): MockResponse {
  const written = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      written.headers[name] = value
    }),
    writeHead: vi.fn((status: number, headers?: Record<string, string>) => {
      written.status = status
      if (headers) Object.assign(written.headers, headers)
    }),
    end: vi.fn((body?: string) => {
      if (body) written.body = body
    }),
    on: vi.fn(),
    headersSent: false
  } as unknown as ServerResponse
  return { res, written }
}

function triggerResponseClose(res: ServerResponse): void {
  const onMock = (res.on as unknown as { mock: { calls: [string, () => void][] } }).mock
  const closeCall = onMock.calls.find(([event]) => event === 'close')
  if (!closeCall) throw new Error('handler did not register a res.on("close") listener')
  closeCall[1]()
}

function createMockMcpServer(): McpServer {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  } as unknown as McpServer
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger
}

describe('transport handler delegation to the SDK', () => {
  const validToken = 'test-bearer-token-12345'
  const port = 18792

  beforeEach(() => {
    vi.clearAllMocks()
    transportInstances.length = 0
  })

  it('delegates authorized requests to transport.handleRequest exactly once', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req } = createMockRequest({
      headers: {
        host: '127.0.0.1:18792',
        authorization: `Bearer ${validToken}`
      }
    })
    const { res } = createMockResponse()

    await handler.handle(req, res)

    const transport = latestMockTransport()
    expect(transport.handleRequest).toHaveBeenCalledTimes(1)
    expect(transport.handleRequest).toHaveBeenCalledWith(req, res, undefined)
    expect(mockServer.connect).toHaveBeenCalledTimes(1)
    expect(mockServer.connect).toHaveBeenCalledWith(transport)
  })

  it('closes transport and server exactly once when the response closes', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req } = createMockRequest({
      headers: {
        host: '127.0.0.1:18792',
        authorization: `Bearer ${validToken}`
      }
    })
    const { res } = createMockResponse()

    await handler.handle(req, res)
    triggerResponseClose(res)
    await Promise.resolve()

    const transport = latestMockTransport()
    expect(transport.close).toHaveBeenCalledTimes(1)
    expect(mockServer.close).toHaveBeenCalledTimes(1)
  })

  it('rejects missing bearer token with 401 and WWW-Authenticate header', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req } = createMockRequest({
      headers: { host: '127.0.0.1:18792' }
    })
    const { res, written } = createMockResponse()

    await handler.handle(req, res)

    expect(written.status).toBe(401)
    expect(written.headers['WWW-Authenticate']).toBe('Bearer realm="bde-mcp"')
    const parsed = JSON.parse(written.body)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.id).toBe(null)
    expect(parsed.error.code).toBe(-32000)
    expect(typeof parsed.error.message).toBe('string')
    expect(transportInstances).toHaveLength(0)
  })

  it('emits a JSON-RPC 2.0 envelope with nested error.code on unhandled failure', async () => {
    const failingServer = {
      connect: vi.fn().mockRejectedValue(new Error('sdk exploded')),
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as McpServer
    const logger = createMockLogger()
    const handler = createTransportHandler(() => failingServer, validToken, port, logger)

    const { req } = createMockRequest({
      headers: {
        host: '127.0.0.1:18792',
        authorization: `Bearer ${validToken}`
      }
    })
    const { res, written } = createMockResponse()

    await handler.handle(req, res)

    expect(written.status).toBe(500)
    const parsed = JSON.parse(written.body)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.id).toBe(null)
    expect(parsed.error).toMatchObject({ code: expect.any(Number), message: expect.any(String) })
    expect(logger.error).toHaveBeenCalled()
  })

  it('rejects wrong URL path with 404', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req } = createMockRequest({
      url: '/api',
      headers: {
        host: '127.0.0.1:18792',
        authorization: `Bearer ${validToken}`
      }
    })
    const { res, written } = createMockResponse()

    await handler.handle(req, res)

    expect(written.status).toBe(404)
    expect(written.body).toContain('Not found')
    expect(transportInstances).toHaveLength(0)
  })
})

describe('transport handler HTTP method allow-list (T-44)', () => {
  const validToken = 'test-bearer-token-12345'
  const port = 18792

  beforeEach(() => {
    vi.clearAllMocks()
    transportInstances.length = 0
  })

  const forbiddenMethods = ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] as const

  forbiddenMethods.forEach((method) => {
    it(`rejects ${method} with 405, Allow: POST, and JSON-RPC envelope`, async () => {
      const mockServer = createMockMcpServer()
      const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

      const { req } = createMockRequest({
        method,
        headers: {
          host: '127.0.0.1:18792',
          authorization: `Bearer ${validToken}`
        }
      })
      const { res, written } = createMockResponse()

      await handler.handle(req, res)

      expect(written.status).toBe(405)
      expect(written.headers['Allow']).toBe('POST')
      const parsed = JSON.parse(written.body)
      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.id).toBe(null)
      expect(parsed.error).toMatchObject({
        code: expect.any(Number),
        message: expect.stringMatching(/POST/)
      })
      expect(transportInstances).toHaveLength(0)
    })
  })
})

describe('transport handler Origin allow-list (T-45)', () => {
  const validToken = 'test-bearer-token-12345'
  const port = 18792

  beforeEach(() => {
    vi.clearAllMocks()
    transportInstances.length = 0
  })

  it('constructs the SDK transport with an explicit loopback Origin allow-list', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req } = createMockRequest({
      headers: {
        host: '127.0.0.1:18792',
        authorization: `Bearer ${validToken}`
      }
    })
    const { res } = createMockResponse()

    await handler.handle(req, res)

    const transport = latestMockTransport()
    expect(transport.constructorOptions.allowedOrigins).toEqual([
      'null',
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`
    ])
  })
})

describe('transport handler body size cap (T-46)', () => {
  const validToken = 'test-bearer-token-12345'
  const port = 18792
  const authHeaders = {
    host: '127.0.0.1:18792',
    authorization: `Bearer ${validToken}`
  }

  beforeEach(() => {
    vi.clearAllMocks()
    transportInstances.length = 0
  })

  it('forwards the parsed JSON body to the SDK as parsedBody', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
    const { req } = createMockRequest(
      { headers: authHeaders },
      { autoEnd: true, autoEndBody: JSON.stringify(payload) }
    )
    const { res } = createMockResponse()

    await handler.handle(req, res)

    const transport = latestMockTransport()
    expect(transport.handleRequest).toHaveBeenCalledWith(req, res, payload)
  })

  it('accepts a request whose Content-Length is under the cap', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req } = createMockRequest(
      { headers: { ...authHeaders, 'content-length': '1024' } },
      { autoEnd: true, autoEndBody: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }
    )
    const { res } = createMockResponse()

    await handler.handle(req, res)

    const transport = latestMockTransport()
    expect(transport.handleRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects a request whose Content-Length exceeds the cap with 413', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const oversized = String(10 * 1024 * 1024)
    const { req } = createMockRequest({
      headers: { ...authHeaders, 'content-length': oversized }
    })
    const { res, written } = createMockResponse()

    await handler.handle(req, res)

    expect(written.status).toBe(413)
    const parsed = JSON.parse(written.body)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.error).toMatchObject({ code: expect.any(Number), message: expect.any(String) })
    expect(transportInstances).toHaveLength(0)
  })

  it('rejects a streamed body that overflows the cap when Content-Length is absent', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req, emitData, destroy } = createMockRequest(
      { headers: authHeaders },
      { autoEnd: false }
    )
    const { res, written } = createMockResponse()

    const handlePromise = handler.handle(req, res)
    await Promise.resolve()
    emitData(Buffer.alloc(3 * 1024 * 1024))
    await handlePromise

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(written.status).toBe(413)
    expect(transportInstances).toHaveLength(0)
  })

  it('allows a streamed body whose cumulative bytes stay under the cap', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req, emitData, emitEnd, destroy } = createMockRequest(
      { headers: authHeaders },
      { autoEnd: false }
    )
    const { res, written } = createMockResponse()

    const handlePromise = handler.handle(req, res)
    await Promise.resolve()
    emitData(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}', 'utf8'))
    emitEnd()
    await handlePromise

    expect(destroy).not.toHaveBeenCalled()
    expect(written.status).toBe(0)
    const transport = latestMockTransport()
    expect(transport.handleRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed JSON with 400 and a parse-error envelope', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const { req } = createMockRequest(
      { headers: authHeaders },
      { autoEnd: true, autoEndBody: '{not valid json' }
    )
    const { res, written } = createMockResponse()

    await handler.handle(req, res)

    expect(written.status).toBe(400)
    const parsed = JSON.parse(written.body)
    expect(parsed.error.code).toBe(-32700)
    expect(transportInstances).toHaveLength(0)
  })
})

describe('transport handler close timeout (T-47)', () => {
  const validToken = 'test-bearer-token-12345'
  const port = 18792
  const authHeaders = {
    host: '127.0.0.1:18792',
    authorization: `Bearer ${validToken}`
  }

  beforeEach(() => {
    vi.clearAllMocks()
    transportInstances.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('logs a timeout warning when transport.close never resolves', async () => {
    const mockServer = createMockMcpServer()
    const logger = createMockLogger()
    const handler = createTransportHandler(() => mockServer, validToken, port, logger)

    const { req } = createMockRequest({ headers: authHeaders })
    const { res } = createMockResponse()

    await handler.handle(req, res)

    const transport = latestMockTransport()
    transport.close.mockImplementation(() => new Promise<void>(() => {}))

    triggerResponseClose(res)
    await vi.advanceTimersByTimeAsync(6_000)

    const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const hasTimeoutWarning = warnCalls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('transport close timeout')
    )
    expect(hasTimeoutWarning).toBe(true)
  })

  it('does not log a warning when close resolves before the timeout', async () => {
    const mockServer = createMockMcpServer()
    const logger = createMockLogger()
    const handler = createTransportHandler(() => mockServer, validToken, port, logger)

    const { req } = createMockRequest({ headers: authHeaders })
    const { res } = createMockResponse()

    await handler.handle(req, res)
    triggerResponseClose(res)
    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.resolve()

    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('transport handler DNS-rebinding protection (real SDK over loopback)', () => {
  const validToken = 'test-bearer-token-12345'

  // Escape-hatch from the module-level mock: this suite needs the real
  // StreamableHTTPServerTransport so the SDK's 403 Host-validation path
  // actually runs.
  beforeEach(() => {
    vi.doUnmock('@modelcontextprotocol/sdk/server/streamableHttp.js')
    vi.resetModules()
  })

  it('returns 403 with JSON-RPC error code -32000 when Host header is foreign', async () => {
    const { createTransportHandler: realHandlerFactory } = await import('./transport')
    const mockServer = createMockMcpServer()
    const server = http.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const handler = realHandlerFactory(() => mockServer, validToken, port, createMockLogger())
    server.on('request', (req, res) => {
      handler.handle(req, res).catch(() => undefined)
    })

    try {
      const response = await sendLoopbackRequest(port, {
        Host: 'evil.example.com',
        Authorization: `Bearer ${validToken}`
      })

      expect(response.status).toBe(403)
      const parsed = JSON.parse(response.body)
      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.error.code).toBe(-32000)
      expect(parsed.error.message).toMatch(/Invalid Host header/i)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

interface LoopbackResponse {
  status: number
  body: string
}

function sendLoopbackRequest(
  port: number,
  headers: Record<string, string>
): Promise<LoopbackResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/mcp',
        headers: { 'Content-Type': 'application/json', ...headers }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      }
    )
    req.on('error', reject)
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
  })
}
