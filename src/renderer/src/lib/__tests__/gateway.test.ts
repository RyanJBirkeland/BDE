import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mock WebSocket ---
let lastWs: MockWebSocket

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static CONNECTING = 0
  static CLOSING = 2

  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  send = vi.fn()
  close = vi.fn()

  constructor(_url: string, _protocols?: string | string[]) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWs = this
  }

  _triggerOpen(): void {
    this.onopen?.()
  }
  _triggerClose(): void {
    this.onclose?.()
  }
  _triggerMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

;(globalThis as unknown as Record<string, unknown>).WebSocket = MockWebSocket

import { GatewayClient, type ConnectionStatus } from '../gateway'

/**
 * The GatewayClient has a challenge/response auth flow:
 * 1. connect() → creates WS
 * 2. onopen → resets retryCount (does NOT emit 'connected' yet)
 * 3. Gateway sends connect.challenge event
 * 4. Client responds with sendConnect (auth token)
 * 5. If auth succeeds (res with ok) → emits 'connected'
 *
 * Helper to drive a full connect + auth cycle:
 */
function simulateFullConnect(): void {
  lastWs._triggerOpen()

  // Gateway sends challenge
  lastWs._triggerMessage({ type: 'event', event: 'connect.challenge' })

  // Client responds with sendConnect — extract the connect request id
  const connectFrame = JSON.parse(lastWs.send.mock.calls[0][0])

  // Gateway responds with success
  lastWs._triggerMessage({
    type: 'res',
    id: connectFrame.id,
    ok: true,
    payload: { protocol: 3 },
  })
}

describe('GatewayClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onStatus: ((status: ConnectionStatus) => void) & ReturnType<typeof vi.fn<any>>

  beforeEach(() => {
    vi.useFakeTimers()
    onStatus = vi.fn() as unknown as ((status: ConnectionStatus) => void) & ReturnType<typeof vi.fn<any>>
    ;(globalThis as unknown as Record<string, unknown>).WebSocket = MockWebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connect sets status to connecting', () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()
    expect(onStatus).toHaveBeenCalledWith('connecting')
  })

  it('full auth cycle sets status to connected', async () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()

    simulateFullConnect()

    // 'connected' is set via promise.then — need to flush microtasks
    await vi.advanceTimersByTimeAsync(0)

    expect(onStatus).toHaveBeenCalledWith('connected')
  })

  it('send sends JSON when WS is open', () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()
    lastWs._triggerOpen()

    client.send({ type: 'test' })
    expect(lastWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }))
  })

  it('send does not throw when WS is not open', () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()
    lastWs.readyState = MockWebSocket.CLOSED

    expect(() => client.send({ type: 'test' })).not.toThrow()
    expect(lastWs.send).not.toHaveBeenCalled()
  })

  it('call queues when not authenticated and sends after auth', async () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()
    lastWs._triggerOpen()

    // Call before auth — should be queued
    const promise = client.call('test.method', { foo: 'bar' })

    // Now authenticate
    lastWs._triggerMessage({ type: 'event', event: 'connect.challenge' })
    const connectFrame = JSON.parse(lastWs.send.mock.calls[0][0])
    lastWs._triggerMessage({ type: 'res', id: connectFrame.id, ok: true, payload: {} })

    // Flush microtask for auth promise.then (which flushes queue)
    await vi.advanceTimersByTimeAsync(0)

    // The queued call should now have been sent
    // Find the call frame (second send call, after the connect req)
    const callFrame = JSON.parse(lastWs.send.mock.calls[1][0])
    expect(callFrame.method).toBe('test.method')
    expect(callFrame.params).toEqual({ foo: 'bar' })

    // Resolve the call
    lastWs._triggerMessage({ type: 'res', id: callFrame.id, ok: true, payload: { result: 'ok' } })
    const result = await promise
    expect(result).toEqual({ result: 'ok' })
  })

  it('call rejects on timeout', async () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()
    lastWs._triggerOpen()

    const promise = client.call('test.method', {}, 100)

    vi.advanceTimersByTime(100)

    await expect(promise).rejects.toThrow('RPC timeout: test.method')
  })

  it('call rejects when response has error', async () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()

    // Do full auth
    simulateFullConnect()
    await vi.advanceTimersByTimeAsync(0)

    const promise = client.call('test.method')

    // Find the call frame (after the auth connect frame)
    const callFrame = JSON.parse(lastWs.send.mock.calls[1][0])
    lastWs._triggerMessage({ type: 'err', id: callFrame.id, ok: false, error: { code: 'ERR', message: 'Something broke' } })

    await expect(promise).rejects.toThrow('Something broke')
  })

  it('onMessage returns unsubscribe function', () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    const listener = vi.fn()
    const unsub = client.onMessage(listener)

    client.connect()
    lastWs._triggerOpen()
    lastWs._triggerMessage({ type: 'event', event: 'custom' })

    expect(listener).toHaveBeenCalledOnce()

    unsub()
    lastWs._triggerMessage({ type: 'event', event: 'custom2' })
    expect(listener).toHaveBeenCalledOnce() // not called again
  })

  it('dispose stops reconnection and emits disconnected', () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()
    lastWs._triggerOpen()

    client.dispose()
    expect(onStatus).toHaveBeenCalledWith('disconnected')
  })

  it('onclose triggers disconnected status', () => {
    const client = new GatewayClient('http://localhost:18789', 'tok', onStatus)
    client.connect()
    lastWs._triggerOpen()

    lastWs._triggerClose()
    expect(onStatus).toHaveBeenCalledWith('disconnected')
  })
})
