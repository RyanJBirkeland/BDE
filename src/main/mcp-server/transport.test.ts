/**
 * Unit tests for DNS rebinding protection and bearer auth in the MCP transport handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createTransportHandler } from './transport'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Logger } from '../logger'

function createMockRequest(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    url: '/mcp',
    headers: {},
    method: 'POST',
    ...overrides
  } as IncomingMessage
}

function createMockResponse(): {
  res: ServerResponse
  written: { status: number; headers: Record<string, string>; body: string }
} {
  const written = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
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

describe('transport handler with DNS rebinding protection', () => {
  const validToken = 'test-bearer-token-12345'
  const port = 18792

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts valid Host header with port and valid bearer token', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const req = createMockRequest({
      headers: {
        host: '127.0.0.1:18792',
        authorization: `Bearer ${validToken}`
      }
    })
    const { res, written } = createMockResponse()

    // Mock the transport.handleRequest to succeed without actual HTTP processing
    const mockTransport = {
      handleRequest: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
    vi.doMock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
      StreamableHTTPServerTransport: vi.fn(() => mockTransport)
    }))

    await handler.handle(req, res)

    // Should not reject with 4xx/5xx before reaching transport.handleRequest
    expect(written.status).not.toBe(401)
    expect(written.status).not.toBe(403)
    expect(written.status).not.toBe(404)
  })

  it('rejects foreign Host header even with valid bearer token', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const req = createMockRequest({
      headers: {
        host: 'evil.example.com',
        authorization: `Bearer ${validToken}`
      }
    })
    const { res, written } = createMockResponse()

    await handler.handle(req, res)

    // DNS rebinding protection should reject this with a non-2xx status
    // The SDK rejects before handleRequest succeeds, resulting in a 500 from our error handler
    expect(written.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects missing bearer token with 401 and WWW-Authenticate header', async () => {
    const mockServer = createMockMcpServer()
    const handler = createTransportHandler(() => mockServer, validToken, port, createMockLogger())

    const req = createMockRequest({
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
  })

  it('emits a JSON-RPC 2.0 envelope with nested error.code on unhandled failure', async () => {
    const failingServer = {
      connect: vi.fn().mockRejectedValue(new Error('sdk exploded')),
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as McpServer
    const logger = createMockLogger()
    const handler = createTransportHandler(() => failingServer, validToken, port, logger)

    const req = createMockRequest({
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

    const req = createMockRequest({
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
  })
})
