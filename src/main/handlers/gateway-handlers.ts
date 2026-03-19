import { safeHandle } from '../ipc-utils'
import { getGatewayConfig } from '../config'

function toHttpUrl(url: string): string {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '')
}

/** Tools the renderer is allowed to invoke via gateway:invoke. */
export const GATEWAY_TOOL_ALLOWLIST = new Set([
  'sessions_list',
  'sessions_send',
  'sessions_spawn',
  'sessions_history',
  'subagents',
])

export function registerGatewayHandlers(): void {
  safeHandle('gateway:invoke', async (_e, tool, args) => {
    if (!GATEWAY_TOOL_ALLOWLIST.has(tool)) {
      throw new Error(`Tool "${tool}" is not in the renderer allowlist`)
    }

    const { url, token } = getGatewayConfig()
    const httpUrl = toHttpUrl(url)
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
    const httpUrl = toHttpUrl(url)
    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool: 'sessions_get_history', args: { sessionKey } })
    })
    if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`)
    return res.json()
  })

  // Test connection -- proxied through main so renderer never sees the stored token.
  // If token is provided (user-entered in settings form), use it; otherwise use stored.
  safeHandle('gateway:test-connection', async (_e, url: string, token?: string) => {
    const effectiveToken = token || getGatewayConfig().token
    const httpUrl = toHttpUrl(url)
    const start = Date.now()
    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveToken}` },
      body: JSON.stringify({ tool: 'sessions_list', args: {} }),
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { ok: boolean }
    if (!data.ok) throw new Error('Gateway returned ok=false')
    return { ok: true, latencyMs: Date.now() - start }
  })

  // Sign the WebSocket connect challenge -- token stays in main process.
  safeHandle('gateway:sign-challenge', () => {
    const { token } = getGatewayConfig()
    return { auth: { token } }
  })
}
