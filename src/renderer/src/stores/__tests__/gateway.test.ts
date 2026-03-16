import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGatewayStore, getGatewayClient, _resetGatewayClientForTesting } from '../gateway'

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
    _resetGatewayClientForTesting()
    useGatewayStore.setState({ status: 'disconnected' })
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
    expect(getGatewayClient()).toBeNull()
  })

  it('connect creates a client', async () => {
    await useGatewayStore.getState().connect()
    expect(getGatewayClient()).not.toBeNull()
  })

  it('calling connect twice does not create duplicate clients', async () => {
    await useGatewayStore.getState().connect()
    const firstClient = getGatewayClient()
    await useGatewayStore.getState().connect()
    const secondClient = getGatewayClient()
    expect(firstClient).toBe(secondClient)
  })

  it('reconnect disposes existing client and creates new one', async () => {
    await useGatewayStore.getState().connect()
    const firstClient = getGatewayClient()
    await useGatewayStore.getState().reconnect()
    const secondClient = getGatewayClient()

    expect(firstClient).not.toBe(secondClient)
    expect(firstClient!.dispose).toHaveBeenCalled()
  })
})
