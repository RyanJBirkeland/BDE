/**
 * Gateway store — manages the WebSocket connection to the OpenClaw gateway.
 * Tracks connection status (connected/disconnected/connecting/error) and
 * shows toast notifications on status transitions.
 */
import { create } from 'zustand'
import { ConnectionStatus, GatewayClient } from '../lib/gateway'
import { toast } from './toasts'
import { GATEWAY_DISCONNECT_TOAST_DELAY } from '../lib/constants'

interface GatewayStore {
  status: ConnectionStatus
  client: GatewayClient | null
  connect: () => Promise<void>
  reconnect: () => Promise<void>
}

export const useGatewayStore = create<GatewayStore>((set, get) => ({
  status: 'disconnected',
  client: null,

  connect: async (): Promise<void> => {
    if (get().client) return

    const { url, token } = await window.api.getGatewayConfig()

    let prevStatus: ConnectionStatus = get().status
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null

    const client = new GatewayClient(url, token, (status) => {
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

    set({ client })
    client.connect()
  },

  reconnect: async (): Promise<void> => {
    const existing = get().client
    if (existing) {
      existing.dispose()
      set({ client: null, status: 'disconnected' })
    }
    await get().connect()
  }
}))
