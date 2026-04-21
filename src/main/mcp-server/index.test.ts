import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { translateCancelError, createMcpServer } from './index'
import { TaskTransitionError } from '../services/sprint-service'
import { McpDomainError, McpErrorCode } from './errors'

/**
 * Fake `http.Server` — captures the request handler, lets the test emit
 * `listen` success, `error`, and deliver synthetic requests. Keeps the
 * `index.ts` lifecycle code exercised without a real network bind.
 */
class FakeHttpServer extends EventEmitter {
  public requestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null
  public listenCalls: Array<{ port: number; host?: string }> = []
  public closeCalls = 0
  private addressObj: { port: number } | null = null
  public listenBehavior: 'success' | 'emit-error' = 'success'
  public listenErrorCode: string | null = null
  public actualPortOnListen = 54321

  listen(port: number, host: string, cb: () => void): this {
    this.listenCalls.push({ port, host })
    if (this.listenBehavior === 'emit-error') {
      const err = new Error(this.listenErrorCode ?? 'listen failed') as NodeJS.ErrnoException
      if (this.listenErrorCode) err.code = this.listenErrorCode
      setImmediate(() => this.emit('error', err))
      return this
    }
    this.addressObj = { port: this.actualPortOnListen }
    setImmediate(() => cb())
    return this
  }

  address(): { port: number } | null {
    return this.addressObj
  }

  close(cb: () => void): this {
    this.closeCalls += 1
    setImmediate(() => cb())
    return this
  }

  deliverRequest(req: IncomingMessage, res: ServerResponse): void {
    if (!this.requestHandler) throw new Error('request handler not wired')
    this.requestHandler(req, res)
  }
}

const hoisted = vi.hoisted(() => {
  const fakeServerRef: { current: FakeHttpServerShape | null } = { current: null }
  const mockBroadcast = vi.fn()
  const mockReadOrCreateToken = vi.fn(async () => ({
    token: 'deadbeef'.repeat(8),
    created: false,
    path: '/tmp/bde-mcp-token-test'
  }))
  const mockTransportHandle = vi.fn(async () => {})
  const mockTransportClose = vi.fn(async () => {})
  const mockCreateTransportHandler = vi.fn(() => ({
    handle: mockTransportHandle,
    close: mockTransportClose
  }))
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
  return {
    fakeServerRef,
    mockBroadcast,
    mockReadOrCreateToken,
    mockTransportHandle,
    mockTransportClose,
    mockCreateTransportHandler,
    mockLogger
  }
})

interface FakeHttpServerShape {
  requestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null
}

const {
  fakeServerRef,
  mockBroadcast,
  mockReadOrCreateToken,
  mockTransportHandle,
  mockTransportClose,
  mockCreateTransportHandler,
  mockLogger
} = hoisted

vi.mock('node:http', () => ({
  default: {
    createServer: vi.fn((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      const server = hoisted.fakeServerRef.current
      if (!server) throw new Error('fakeServerRef not initialized before createServer')
      server.requestHandler = handler
      return server
    })
  }
}))

vi.mock('../broadcast', () => ({
  broadcast: (...args: unknown[]) => hoisted.mockBroadcast(...args)
}))

vi.mock('../logger', () => ({
  createLogger: () => hoisted.mockLogger
}))

vi.mock('./token-store', () => ({
  readOrCreateToken: (...args: unknown[]) => hoisted.mockReadOrCreateToken(...args)
}))

vi.mock('./transport', () => ({
  createTransportHandler: (...args: unknown[]) => hoisted.mockCreateTransportHandler(...args)
}))

vi.mock('./safe-tool-handler', () => ({
  wrapServerWithSafeToolHandlers: (server: unknown) => server
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    tool = vi.fn()
    close = vi.fn()
    connect = vi.fn()
  }
}))

vi.mock('./tools/tasks', () => ({
  registerTaskTools: vi.fn()
}))

vi.mock('./tools/epics', () => ({
  registerEpicTools: vi.fn()
}))

vi.mock('./tools/meta', () => ({
  registerMetaTools: vi.fn()
}))

vi.mock('../services/sprint-service', async () => {
  const actual = await vi.importActual<typeof import('../services/sprint-service')>(
    '../services/sprint-service'
  )
  return {
    ...actual,
    cancelTask: vi.fn(),
    createTaskWithValidation: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(),
    updateTask: vi.fn()
  }
})

vi.mock('../data/task-changes', () => ({
  getTaskChanges: vi.fn(() => [])
}))

vi.mock('../settings', () => ({
  getSettingJson: vi.fn(() => [])
}))

describe('translateCancelError', () => {
  it('maps TaskTransitionError to McpDomainError with InvalidTransition kind', () => {
    const source = new TaskTransitionError('Invalid transition: done → cancelled', {
      taskId: 't1',
      fromStatus: 'done',
      toStatus: 'cancelled'
    })

    const translated = translateCancelError(source)

    expect(translated).toBeInstanceOf(McpDomainError)
    const domainError = translated as McpDomainError
    expect(domainError.kind).toBe(McpErrorCode.InvalidTransition)
    expect(domainError.message).toContain('Invalid transition')
    expect(domainError.data).toEqual({
      taskId: 't1',
      fromStatus: 'done',
      toStatus: 'cancelled'
    })
  })

  it('passes unknown errors through unchanged', () => {
    const err = new Error('disk full')
    expect(translateCancelError(err)).toBe(err)
  })
})

describe('createMcpServer lifecycle', () => {
  const epicService = {} as never
  const onStatusTerminal = vi.fn()
  let fakeServer: FakeHttpServer

  beforeEach(() => {
    fakeServer = new FakeHttpServer()
    fakeServerRef.current = fakeServer
    mockBroadcast.mockClear()
    mockReadOrCreateToken.mockClear()
    mockTransportHandle.mockClear()
    mockTransportClose.mockClear()
    mockCreateTransportHandler.mockClear()
    mockLogger.info.mockClear()
    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()
    mockLogger.debug.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('start() resolves with the actual port reported by httpServer.address()', async () => {
    fakeServer.actualPortOnListen = 12345
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })

    const port = await handle.start()

    expect(port).toBe(12345)
    expect(fakeServer.listenCalls).toEqual([{ port: 0, host: '127.0.0.1' }])
    expect(mockCreateTransportHandler).toHaveBeenCalledTimes(1)
  })

  it('start() logs the token path without "newly minted" when the token already existed', async () => {
    mockReadOrCreateToken.mockResolvedValueOnce({
      token: 'cafebabe'.repeat(8),
      created: false,
      path: '/tmp/bde-existing-token'
    })
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })

    await handle.start()

    const tokenLog = mockLogger.info.mock.calls
      .map((call) => call[0] as string)
      .find((msg) => msg.includes('MCP bearer token at'))
    expect(tokenLog).toBe('MCP bearer token at /tmp/bde-existing-token')
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  it('start() broadcasts a manager:warning when the token was freshly minted', async () => {
    mockReadOrCreateToken.mockResolvedValueOnce({
      token: 'feedface'.repeat(8),
      created: true,
      path: '/tmp/bde-fresh-token'
    })
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })

    await handle.start()

    const tokenLog = mockLogger.info.mock.calls
      .map((call) => call[0] as string)
      .find((msg) => msg.includes('MCP bearer token at'))
    expect(tokenLog).toBe('MCP bearer token at /tmp/bde-fresh-token (newly minted)')
    expect(mockBroadcast).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({
        message: expect.stringContaining('fresh token minted at /tmp/bde-fresh-token')
      })
    )
  })

  it('start() passes the logger through to readOrCreateToken for diagnostics', async () => {
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })

    await handle.start()

    expect(mockReadOrCreateToken).toHaveBeenCalledWith(undefined, { logger: mockLogger })
  })

  it('start() rejects with EADDRINUSE and broadcasts manager:warning', async () => {
    fakeServer.listenBehavior = 'emit-error'
    fakeServer.listenErrorCode = 'EADDRINUSE'
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 18792 })

    await expect(handle.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })

    const errorLog = mockLogger.error.mock.calls[0]?.[0] as string
    expect(errorLog).toMatch(/already in use/)
    expect(mockBroadcast).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({ message: expect.any(String) })
    )
  })

  it('start() rejects on non-EADDRINUSE listener errors with a generic failure log', async () => {
    fakeServer.listenBehavior = 'emit-error'
    fakeServer.listenErrorCode = 'EACCES'
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 80 })

    await expect(handle.start()).rejects.toMatchObject({ code: 'EACCES' })

    const errorLog = mockLogger.error.mock.calls[0]?.[0] as string
    expect(errorLog).toMatch(/failed to start/)
    expect(errorLog).not.toMatch(/already in use/)
    expect(mockBroadcast).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({ message: expect.any(String) })
    )
  })

  it('stop() is a no-op before start() — does not close a server that never opened', async () => {
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })

    await expect(handle.stop()).resolves.toBeUndefined()

    expect(fakeServer.closeCalls).toBe(0)
    expect(mockTransportClose).not.toHaveBeenCalled()
  })

  it('stop() is idempotent — calling twice after start() closes once then no-ops', async () => {
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })
    await handle.start()

    await handle.stop()
    await handle.stop()

    expect(fakeServer.closeCalls).toBe(1)
    expect(mockTransportClose).toHaveBeenCalledTimes(1)
  })

  it('request handler writes a JSON-RPC 2.0 envelope when transportHandler.handle rejects', async () => {
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })
    await handle.start()

    mockTransportHandle.mockRejectedValueOnce(new Error('transport blew up'))

    const req = { method: 'POST', url: '/mcp' } as IncomingMessage
    const { res, body } = captureResponse()
    fakeServer.deliverRequest(req, res)
    await flushMicrotasks()

    const parsed = JSON.parse(body.value)
    expect(parsed).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: expect.objectContaining({
        code: expect.any(Number),
        message: expect.any(String)
      })
    })

    const loggedMessages = mockLogger.error.mock.calls.map((call) => call[0] as string)
    expect(loggedMessages.some((msg) => msg.includes('mcp transport unhandled'))).toBe(true)
  })
})

interface ResponseCapture {
  res: ServerResponse
  body: { value: string }
}

function captureResponse(): ResponseCapture {
  const body = { value: '' }
  const res = {
    headersSent: false,
    writeHead: vi.fn(function writeHead(this: ServerResponse) {
      ;(this as unknown as { headersSent: boolean }).headersSent = true
      return this
    }),
    end: vi.fn((chunk?: string) => {
      if (typeof chunk === 'string') body.value = chunk
    })
  } as unknown as ServerResponse
  return { res, body }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
