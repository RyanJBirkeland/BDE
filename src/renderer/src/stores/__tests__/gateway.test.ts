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
  GatewayClient.mockImplementation(function (this: { _onStatus: (s: string) => void }, _url: string, _signChallenge: unknown, onStatus: (s: string) => void) {
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

    // Mock window.api — assign directly to preserve window methods
    Object.defineProperty(window, 'api', {
      value: {
        getGatewayUrl: vi.fn().mockResolvedValue({ url: 'http://localhost:18789', hasToken: true }),
        signGatewayChallenge: vi.fn().mockResolvedValue({ auth: { token: 'test-token' } }),
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

  it('connect sets status to connected', async () => {
    await useGatewayStore.getState().connect()
    expect(useGatewayStore.getState().status).toBe('connected')
  })

  it('calling connect twice does not create duplicate clients', async () => {
    await useGatewayStore.getState().connect()
    const firstClient = getGatewayClient()
    await useGatewayStore.getState().connect()
    const secondClient = getGatewayClient()
    expect(firstClient).toBe(secondClient)
  })

  it('reconnect transitions through disconnected to connected', async () => {
    await useGatewayStore.getState().connect()
    expect(useGatewayStore.getState().status).toBe('connected')

    await useGatewayStore.getState().reconnect()

    // After reconnect, status should be connected again with a new client
    expect(useGatewayStore.getState().status).toBe('connected')
  })

  it('sets not-configured when url is empty', async () => {
    _resetGatewayClientForTesting()
    useGatewayStore.setState({ status: 'disconnected' })
    Object.defineProperty(window, 'api', {
      value: {
        getGatewayUrl: vi.fn().mockResolvedValue({ url: '', hasToken: false }),
        signGatewayChallenge: vi.fn().mockResolvedValue({ auth: { token: 'test-token' } }),
      },
      writable: true,
      configurable: true,
    })

    await useGatewayStore.getState().connect()
    expect(useGatewayStore.getState().status).toBe('not-configured')
    expect(getGatewayClient()).toBeNull()
  })

  it('sets not-configured when hasToken is false', async () => {
    _resetGatewayClientForTesting()
    useGatewayStore.setState({ status: 'disconnected' })
    Object.defineProperty(window, 'api', {
      value: {
        getGatewayUrl: vi.fn().mockResolvedValue({ url: 'http://localhost:18789', hasToken: false }),
        signGatewayChallenge: vi.fn().mockResolvedValue({ auth: { token: 'test-token' } }),
      },
      writable: true,
      configurable: true,
    })

    await useGatewayStore.getState().connect()
    expect(useGatewayStore.getState().status).toBe('not-configured')
    expect(getGatewayClient()).toBeNull()
  })
})
