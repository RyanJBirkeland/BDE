import { create } from 'zustand'
import { ConnectionStatus, GatewayClient } from '../lib/gateway'
import { toast } from './toasts'

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

    let prevStatus: ConnectionStatus = get().status
    const client = new GatewayClient(url, token, (status) => {
      set({ status })
      if (status === 'connected' && prevStatus !== 'connected') {
        toast.success('Gateway connected')
      } else if (status === 'disconnected' && prevStatus === 'connected') {
        toast.error('Gateway disconnected')
      } else if (status === 'error' && prevStatus !== 'error') {
        toast.error('Gateway connection error')
      }
      prevStatus = status
    })

    set({ client })
    client.connect()
  }
}))
