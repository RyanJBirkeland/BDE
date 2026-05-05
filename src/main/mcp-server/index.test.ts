import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { translateCancelError, createMcpServer, summarizeListenError } from './index'
import { TaskTransitionError } from '../services/sprint-service'
import { McpDomainError, McpErrorCode } from './errors'

/**
 * Fake `http.Server` — captures the request handler, lets the test emit
 * `listen` success, `error`, and deliver synthetic requests. Keeps the
 * `index.ts` lifecycle code exercised without a real network bind.
 *
 * Exposes `headersTimeout`/`requestTimeout`/`keepAliveTimeout` so the
 * timeouts applied by `applyServerTimeouts` can be asserted (T-26), and
 * `closeAllConnections` so the shutdown-deadline path (T-27) can assert
 * force-close was reached.
 */
class FakeHttpServer extends EventEmitter {
  public requestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null
  public listenCalls: Array<{ port: number; host?: string }> = []
  public closeCalls = 0
  public closeAllConnectionsCalls = 0
  public headersTimeout = 0
  public requestTimeout = 0
  public keepAliveTimeout = 0
  private addressObj: { port: number } | null = null
  public listenBehavior: 'success' | 'emit-error' | 'defer-callback' = 'success'
  public listenErrorCode: string | null = null
  public actualPortOnListen = 54321
  /** Captured listen callback for `listenBehavior === 'defer-callback'`. */
  public pendingListenCallback: (() => void) | null = null
  /** When true, `close(cb)` will NOT fire its callback — simulates a stuck socket. */
  public closeNeverResolves = false

  listen(port: number, host: string, cb: () => void): this {
    this.listenCalls.push({ port, host })
    if (this.listenBehavior === 'emit-error') {
      const err = new Error(this.listenErrorCode ?? 'listen failed') as NodeJS.ErrnoException
      if (this.listenErrorCode) err.code = this.listenErrorCode
      setImmediate(() => this.emit('error', err))
      return this
    }
    this.addressObj = { port: this.actualPortOnListen }
    if (this.listenBehavior === 'defer-callback') {
      // Do not fire cb automatically — the test will fire it explicitly to
      // prove the request-before-ready path returns 503 (T-25).
      this.pendingListenCallback = cb
      return this
    }
    setImmediate(() => cb())
    return this
  }

  address(): { port: number } | null {
    return this.addressObj
  }

  close(cb?: () => void): this {
    this.closeCalls += 1
    if (this.closeNeverResolves) return this
    if (cb) setImmediate(() => cb())
    return this
  }

  closeAllConnections(): void {
    this.closeAllConnectionsCalls += 1
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
    path: '/tmp/fleet-mcp-token-test'
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
  createLogger: () => hoisted.mockLogger,
  logError: (logger: typeof hoisted.mockLogger, context: string, err: unknown) => {
    if (err instanceof Error) {
      logger.error(`${context}: ${err.message}`)
      if (err.stack) {
        logger.debug(`Stack: ${err.stack.split('\n').slice(1, 4).join(' | ')}`)
      }
    } else {
      logger.error(`${context}: ${String(err)}`)
    }
  }
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
    getTaskChanges: vi.fn(() => []),
    listTasks: vi.fn(),
    updateTask: vi.fn()
  }
})

vi.mock('../settings', () => ({
  getSettingJson: vi.fn(() => [])
}))

describe('summarizeListenError', () => {
  it('produces the friendly port-in-use message for EADDRINUSE', () => {
    const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })
    expect(summarizeListenError(err, 18792)).toBe(
      'MCP server could not bind to port 18792 — already in use.'
    )
  })

  it('produces a generic message for non-EADDRINUSE errors (no raw error leaked)', () => {
    const err = Object.assign(new Error('permission denied /etc/secret'), { code: 'EACCES' })
    const summary = summarizeListenError(err, 80)
    expect(summary).not.toMatch(/EACCES/)
    expect(summary).not.toMatch(/permission/)
    expect(summary).not.toMatch(/secret/)
    expect(summary).toMatch(/See .*\.fleet\/fleet\.log/)
  })

  it('produces the generic message when err is not an Error instance', () => {
    expect(summarizeListenError('raw string with /sensitive/path', 80)).toMatch(/See/)
    expect(summarizeListenError(null, 80)).toMatch(/See/)
  })
})

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
    expect(domainError.message).toBe("Cannot transition task from 'done' to 'cancelled'.")
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

  it('produces a friendly "already <status>" message when re-cancelling an already-cancelled task', () => {
    const source = new TaskTransitionError(
      '[sprint-task-crud] Bypass-prevention: ... Route through TaskStateService.transition() instead.',
      { taskId: 't1', fromStatus: 'cancelled', toStatus: 'cancelled' }
    )

    const translated = translateCancelError(source)

    expect(translated).toBeInstanceOf(McpDomainError)
    const domainError = translated as McpDomainError
    expect(domainError.message).toBe('Task is already cancelled.')
    expect(domainError.message).not.toContain('sprint-task-crud')
    expect(domainError.message).not.toContain('Bypass-prevention')
    expect(domainError.message).not.toContain('Route through')
    expect(domainError.data).toEqual({
      taskId: 't1',
      fromStatus: 'cancelled',
      toStatus: 'cancelled'
    })
  })

  it('produces a friendly transition message when fromStatus differs from toStatus', () => {
    const source = new TaskTransitionError(
      '[sprint-task-crud] Bypass-prevention: internal message',
      { taskId: 't2', fromStatus: 'done', toStatus: 'cancelled' }
    )

    const translated = translateCancelError(source)

    expect(translated).toBeInstanceOf(McpDomainError)
    const domainError = translated as McpDomainError
    expect(domainError.message).toBe("Cannot transition task from 'done' to 'cancelled'.")
    expect(domainError.message).not.toContain('sprint-task-crud')
    expect(domainError.data).toEqual({
      taskId: 't2',
      fromStatus: 'done',
      toStatus: 'cancelled'
    })
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
      path: '/tmp/fleet-existing-token'
    })
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })

    await handle.start()

    const tokenLog = mockLogger.info.mock.calls
      .map((call) => call[0] as string)
      .find((msg) => msg.includes('MCP bearer token at'))
    expect(tokenLog).toBe('MCP bearer token at /tmp/fleet-existing-token')
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  it('start() broadcasts a manager:warning when the token was freshly minted', async () => {
    mockReadOrCreateToken.mockResolvedValueOnce({
      token: 'feedface'.repeat(8),
      created: true,
      path: '/tmp/fleet-fresh-token'
    })
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })

    await handle.start()

    const tokenLog = mockLogger.info.mock.calls
      .map((call) => call[0] as string)
      .find((msg) => msg.includes('MCP bearer token at'))
    expect(tokenLog).toBe('MCP bearer token at /tmp/fleet-fresh-token (newly minted)')
    expect(mockBroadcast).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({
        message: expect.stringContaining('fresh token minted at /tmp/fleet-fresh-token')
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

    // Full detail in the log (via logError), sanitized summary in the broadcast.
    const errorLog = mockLogger.error.mock.calls[0]?.[0] as string
    expect(errorLog).toMatch(/MCP server listen\(18792\)/)
    expect(mockBroadcast).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({ message: expect.stringMatching(/already in use/) })
    )
  })

  it('start() rejects on non-EADDRINUSE listener errors with a generic failure log', async () => {
    fakeServer.listenBehavior = 'emit-error'
    fakeServer.listenErrorCode = 'EACCES'
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 80 })

    await expect(handle.start()).rejects.toMatchObject({ code: 'EACCES' })

    const errorLog = mockLogger.error.mock.calls[0]?.[0] as string
    expect(errorLog).toMatch(/MCP server listen\(80\)/)
    expect(mockBroadcast).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({ message: expect.any(String) })
    )
  })

  it('start() does NOT leak raw error code / message / stack into the broadcast body (T-37)', async () => {
    fakeServer = new FakeHttpServer()
    fakeServerRef.current = fakeServer
    fakeServer.listenBehavior = 'emit-error'
    // Custom emit-error path with a crafted stack containing a sensitive path.
    fakeServer.listen = function listen(port, host, _cb) {
      this.listenCalls.push({ port, host })
      const err = new Error(
        'listen EACCES 0.0.0.0:80 /private/var/secret/socket'
      ) as NodeJS.ErrnoException
      err.code = 'EACCES'
      err.stack =
        'Error: listen EACCES\n' +
        '    at /Users/me/sensitive/path/boot.ts:12:7\n' +
        '    at Server.listen (node:net:0:0)'
      setImmediate(() => this.emit('error', err))
      return this
    } as typeof fakeServer.listen

    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 80 })
    await expect(handle.start()).rejects.toMatchObject({ code: 'EACCES' })

    // Broadcast body is the sanitized summary — no raw error code, path, or stack.
    const broadcastCall = mockBroadcast.mock.calls[0]
    expect(broadcastCall?.[0]).toBe('manager:warning')
    const broadcastMessage = (broadcastCall?.[1] as { message: string }).message
    expect(broadcastMessage).not.toMatch(/EACCES/)
    expect(broadcastMessage).not.toMatch(/sensitive/)
    expect(broadcastMessage).not.toMatch(/boot\.ts/)
    expect(broadcastMessage).not.toMatch(/private\/var/)

    // But the error log DID capture context. logError writes the stack at
    // `debug` level, so we assert the debug sink saw the sensitive detail.
    const debugMessages = mockLogger.debug.mock.calls.map((call) => call[0] as string)
    const loggedStack = debugMessages.some((msg) => msg.includes('sensitive'))
    expect(loggedStack).toBe(true)
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

  it('responds 503 JSON-RPC when a request arrives before listen() completes (T-25)', async () => {
    // `defer-callback` stages the listen cb so the test can deliver a
    // request while the transport handler is still null — the exact race
    // window the `!` non-null assertion used to crash on.
    fakeServer.listenBehavior = 'defer-callback'
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })
    const startPromise = handle.start()
    // Let readOrCreateToken resolve so bindHttpServer actually runs and
    // the requestHandler + pending listen cb get wired up.
    await flushMicrotasks()
    expect(fakeServer.pendingListenCallback).not.toBeNull()

    // Deliver a request BEFORE firing the listen callback. transportHandler
    // is still null, so routeRequest must answer 503 rather than crash.
    const req = { method: 'POST', url: '/mcp' } as IncomingMessage
    const { res, body } = captureResponse()
    fakeServer.deliverRequest(req, res)

    const parsed = JSON.parse(body.value)
    expect(parsed).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: expect.objectContaining({
        code: expect.any(Number),
        message: expect.any(String)
      })
    })
    expect(res.writeHead).toHaveBeenCalledWith(503, expect.any(Object))

    // Clean up — fire the deferred listen cb so start() resolves.
    fakeServer.pendingListenCallback?.()
    await startPromise
  })

  it('applies headers/request/keep-alive timeouts before listen so slow clients cannot stall the loop (T-26)', async () => {
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })
    await handle.start()

    expect(fakeServer.headersTimeout).toBeGreaterThan(0)
    expect(fakeServer.requestTimeout).toBeGreaterThan(0)
    expect(fakeServer.keepAliveTimeout).toBeGreaterThan(0)
    // `requestTimeout` should allow the full body to arrive within the SDK SLA.
    expect(fakeServer.requestTimeout).toBeGreaterThanOrEqual(fakeServer.headersTimeout)
  })

  it('closes the httpServer on listener error so no dangling bind leaks (T-26)', async () => {
    fakeServer.listenBehavior = 'emit-error'
    fakeServer.listenErrorCode = 'EADDRINUSE'
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 18792 })

    await expect(handle.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })

    expect(fakeServer.closeCalls).toBeGreaterThanOrEqual(1)
  })

  it('stop() resolves within the hard deadline even when close() never fires its callback (T-27)', async () => {
    const handle = createMcpServer({ epicService, onStatusTerminal }, { port: 0 })
    await handle.start()

    // Simulate a stuck socket: close() registers but never fires its cb.
    fakeServer.closeNeverResolves = true
    vi.useFakeTimers()
    try {
      const stopPromise = handle.stop()
      // Grace timer fires at 3s — force-close should happen then.
      await vi.advanceTimersByTimeAsync(3_100)
      expect(fakeServer.closeAllConnectionsCalls).toBe(1)
      // Hard deadline fires at 5s total — stop() resolves regardless.
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(stopPromise).resolves.toBeUndefined()
      // And a warn landed so operators see the stuck close.
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/force-closing/))
    } finally {
      vi.useRealTimers()
    }
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
