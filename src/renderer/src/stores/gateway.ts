/**
 * Gateway store — manages the WebSocket connection to the OpenClaw gateway.
 * Tracks connection status (connected/disconnected/connecting/error) and
 * shows toast notifications on status transitions.
 *
 * The GatewayClient instance lives at module scope — not in Zustand — because
 * it's a mutable object with WebSocket handles, timers, and pending promise
 * queues. Zustand state is reserved for serializable data.
 */
import { create } from 'zustand'
import { ConnectionStatus, GatewayClient } from '../lib/gateway'
import { toast } from './toasts'
import { GATEWAY_DISCONNECT_TOAST_DELAY } from '../lib/constants'

// Module scope — outside Zustand
let _gatewayClient: GatewayClient | null = null

export function getGatewayClient(): GatewayClient | null {
  return _gatewayClient
}

/** @internal Test-only — resets the module-scope client */
export function _resetGatewayClientForTesting(): void {
  if (_gatewayClient) {
    _gatewayClient.dispose()
  }
  _gatewayClient = null
}

interface GatewayStore {
  status: ConnectionStatus
  connect: () => Promise<void>
  reconnect: () => Promise<void>
}

export const useGatewayStore = create<GatewayStore>((set, get) => ({
  status: 'disconnected',

  connect: async (): Promise<void> => {
    if (_gatewayClient) return

    const { url, token } = await window.api.getGatewayConfig()

    let prevStatus: ConnectionStatus = get().status
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null

    _gatewayClient = new GatewayClient(url, token, (status) => {
      set({ status })

      if (status === 'connected') {
        // Cancel any pending disconnect toast — reconnected in time
        if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null }
        if (prevStatus !== 'connected') toast.success('Gateway connected')
      } else if (status === 'disconnected' && prevStatus === 'connected') {
        // Only toast after 4s — avoids noise from brief reconnect cycles
        disconnectTimer = setTimeout(() => {
          if (get().status !== 'connected') toast.error('Gateway disconnected')
          disconnectTimer = null
        }, GATEWAY_DISCONNECT_TOAST_DELAY)
      } else if (status === 'error' && prevStatus !== 'error') {
        toast.error('Gateway connection error')
      }

      prevStatus = status
    })

    _gatewayClient.connect()
  },

  reconnect: async (): Promise<void> => {
    if (_gatewayClient) {
      _gatewayClient.dispose()
      _gatewayClient = null
      set({ status: 'disconnected' })
    }
    await get().connect()
  }
}))
