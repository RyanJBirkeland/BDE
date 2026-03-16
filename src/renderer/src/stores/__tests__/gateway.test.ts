import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGatewayStore } from '../gateway'

vi.mock('../../lib/gateway', () => {
  const GatewayClient = vi.fn()
  GatewayClient.prototype.connect = vi.fn(function (this: { _onStatus: (s: string) => void }) {
    this._onStatus('connected')
  })
  GatewayClient.prototype.call = vi.fn().mockResolvedValue({})
  GatewayClient.prototype.send = vi.fn()
  GatewayClient.prototype.onMessage = vi.fn(() => vi.fn())
  GatewayClient.prototype.dispose = vi.fn()

  // Capture the onStatus callback in the constructor
  GatewayClient.mockImplementation(function (this: { _onStatus: (s: string) => void }, _url: string, _token: string, onStatus: (s: string) => void) {
    this._onStatus = onStatus
  })

  return { GatewayClient }
})

vi.mock('../toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('gateway store', () => {
  beforeEach(() => {
    useGatewayStore.setState({ status: 'disconnected', client: null })
    vi.clearAllMocks()

    // Mock window.api.getGatewayConfig — assign directly to preserve window methods
    Object.defineProperty(window, 'api', {
      value: {
        getGatewayConfig: vi.fn().mockResolvedValue({ url: 'http://localhost:18789', token: 'test-token' }),
      },
      writable: true,
      configurable: true,
    })
  })

  it('initial status is disconnected', () => {
    expect(useGatewayStore.getState().status).toBe('disconnected')
  })

  it('initial client is null', () => {
    expect(useGatewayStore.getState().client).toBeNull()
  })

  it('connect sets client', async () => {
    await useGatewayStore.getState().connect()
    expect(useGatewayStore.getState().client).not.toBeNull()
  })

  it('calling connect twice does not create duplicate clients', async () => {
    await useGatewayStore.getState().connect()
    const firstClient = useGatewayStore.getState().client
    await useGatewayStore.getState().connect()
    const secondClient = useGatewayStore.getState().client
    expect(firstClient).toBe(secondClient)
  })

  it('reconnect disposes existing client and creates new one', async () => {
    await useGatewayStore.getState().connect()
    const firstClient = useGatewayStore.getState().client
    await useGatewayStore.getState().reconnect()
    const secondClient = useGatewayStore.getState().client

    expect(firstClient).not.toBe(secondClient)
    expect(firstClient!.dispose).toHaveBeenCalled()
  })
})
