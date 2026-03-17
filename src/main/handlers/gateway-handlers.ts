import { safeHandle } from '../ipc-utils'
import { getGatewayConfig } from '../config'

export function registerGatewayHandlers(): void {
  // TODO: AX-S1 — add 'gateway:invoke', 'gateway:getSessionHistory' to IpcChannelMap
  safeHandle('gateway:invoke', async (_e, tool: string, args: Record<string, unknown>) => {
    const { url, token } = getGatewayConfig()
    const httpUrl = url.replace(/^wss?:\/\//, 'http://').replace(/\/$/, '')
    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool, args })
    })
    if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`)
    return res.json()
  })

  safeHandle('gateway:getSessionHistory', async (_e, sessionKey: string) => {
    const { url, token } = getGatewayConfig()
    const httpUrl = url.replace(/^wss?:\/\//, 'http://').replace(/\/$/, '')
    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool: 'sessions_get_history', args: { sessionKey } })
    })
    if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`)
    return res.json()
  })
}
