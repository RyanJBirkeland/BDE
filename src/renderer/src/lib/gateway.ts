export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

type StatusListener = (status: ConnectionStatus) => void
type MessageListener = (data: unknown) => void

const MAX_BACKOFF = 30_000
const BASE_BACKOFF = 1_000

interface ResFrame {
  type: 'res' | 'err'
  id: string
  ok: boolean
  payload?: unknown
  error?: { code: string; message: string }
}

interface EventFrame {
  type: 'event'
  event: string
  payload?: unknown
}

export class GatewayClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private statusListener: StatusListener
  private messageListeners = new Set<MessageListener>()
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private authenticated = false
  private sendQueue: string[] = []

  constructor(url: string, token: string, onStatus: StatusListener) {
    this.url = url
    this.token = token
    this.statusListener = onStatus
  }

  connect(): void {
    if (this.disposed) return
    this.cleanup()
    this.authenticated = false
    this.statusListener('connecting')

    const wsUrl = new URL(this.url)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

    // No subprotocol — auth is done via connect challenge/response
    this.ws = new WebSocket(wsUrl.toString())

    this.ws.onopen = (): void => {
      this.retryCount = 0
      // Don't emit 'connected' yet — wait for challenge/auth
    }

    this.ws.onclose = (): void => {
      if (this.disposed) return
      this.authenticated = false
      this.flushPending(new Error('Gateway disconnected'))
      this.statusListener('disconnected')
      this.scheduleReconnect()
    }

    this.ws.onerror = (): void => {
      if (this.disposed) return
      this.statusListener('error')
    }

    this.ws.onmessage = (event: MessageEvent): void => {
      try {
        const data = JSON.parse(event.data as string)
        this.handleMessage(data)
      } catch {
        // ignore non-JSON
      }
    }
  }

  private handleMessage(data: unknown): void {
    const msg = data as { type?: string; event?: string; id?: string; ok?: boolean; payload?: unknown; error?: { code: string; message: string } }

    // Broadcast to all message listeners (for external subscribers)
    for (const listener of this.messageListeners) {
      listener(data)
    }

    if (msg.type === 'event') {
      const evt = msg as EventFrame
      if (evt.event === 'connect.challenge') {
        this.sendConnect()
      }
      return
    }

    if (msg.type === 'res' || msg.type === 'err') {
      const res = msg as ResFrame
      const pending = this.pending.get(res.id)
      if (!pending) return
      this.pending.delete(res.id)

      if (!res.ok) {
        pending.reject(new Error(res.error?.message ?? 'Gateway error'))
      } else {
        pending.resolve(res.payload)
      }
    }
  }

  private sendConnect(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    console.log('[GatewayClient] sending connect challenge response')
    const id = crypto.randomUUID()

    const pending = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })

    this.ws.send(JSON.stringify({
      type: 'req',
      id,
      method: 'connect',
      params: {
        auth: { token: this.token },
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          version: '0.1.0',
          platform: 'darwin',
          mode: 'ui'
        },
        role: 'operator',
        scopes: ['operator.admin', 'operator.read', 'operator.write']
      }
    }))

    pending
      .then(() => {
        this.authenticated = true
        console.log('[GatewayClient] authenticated ✓, flushing', this.sendQueue.length, 'queued calls')
        this.statusListener('connected')
        // Flush queued calls
        const queued = [...this.sendQueue]
        this.sendQueue = []
        for (const msg of queued) {
          this.ws?.send(msg)
        }
      })
      .catch((err) => {
        console.error('[GatewayClient] connect failed:', err?.message)
        this.statusListener('error')
        this.ws?.close()
      })
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })

      const frame = JSON.stringify({ type: 'req', id, method, params })

      if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(frame)
      } else {
        this.sendQueue.push(frame)
      }
    })
  }

  /** Raw send — prefer call() for request/response */
  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  private flushPending(err: Error): void {
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
    this.sendQueue = []
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    const delay = Math.min(BASE_BACKOFF * Math.pow(2, this.retryCount), MAX_BACKOFF)
    this.retryCount++
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  private cleanup(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }
  }

  dispose(): void {
    this.disposed = true
    this.flushPending(new Error('Gateway client disposed'))
    this.cleanup()
    this.messageListeners.clear()
    this.statusListener('disconnected')
  }
}
