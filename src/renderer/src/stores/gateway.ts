import { create } from 'zustand'
import { ConnectionStatus, GatewayClient } from '../lib/gateway'

interface GatewayStore {
  status: ConnectionStatus
  client: GatewayClient | null
  connect: () => Promise<void>
}

export const useGatewayStore = create<GatewayStore>((set, get) => ({
  status: 'disconnected',
  client: null,

  connect: async (): Promise<void> => {
    if (get().client) return

    const { url, token } = await window.api.getGatewayConfig()

    const client = new GatewayClient(url, token, (status) => {
      set({ status })
    })

    set({ client })
    client.connect()
  }
}))
