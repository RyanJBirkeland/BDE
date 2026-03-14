export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

type StatusListener = (status: ConnectionStatus) => void

const MAX_BACKOFF = 30_000
const BASE_BACKOFF = 1_000

export class GatewayClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private listener: StatusListener
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(url: string, token: string, onStatus: StatusListener) {
    this.url = url
    this.token = token
    this.listener = onStatus
  }

  connect(): void {
    if (this.disposed) return
    this.cleanup()
    this.listener('connecting')

    const wsUrl = new URL(this.url)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

    this.ws = new WebSocket(wsUrl.toString(), ['openclaw', this.token])

    this.ws.onopen = (): void => {
      this.retryCount = 0
      this.listener('connected')
    }

    this.ws.onclose = (): void => {
      if (this.disposed) return
      this.listener('disconnected')
      this.scheduleReconnect()
    }

    this.ws.onerror = (): void => {
      if (this.disposed) return
      this.listener('error')
    }
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
      this.ws.close()
      this.ws = null
    }
  }

  dispose(): void {
    this.disposed = true
    this.cleanup()
    this.listener('disconnected')
  }
}
