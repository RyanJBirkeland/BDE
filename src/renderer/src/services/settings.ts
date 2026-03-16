export interface GatewayConfig {
  url: string
  token: string
}

export async function loadConfig(): Promise<GatewayConfig> {
  return window.api.getGatewayConfig()
}

export async function saveConfig(config: GatewayConfig): Promise<void> {
  return window.api.saveGatewayConfig(config.url, config.token)
}

export async function testConnection(
  url: string,
  token: string
): Promise<{ ok: boolean; latencyMs: number }> {
  const httpUrl = url.replace(/^wss?:\/\//, 'http://').replace(/\/$/, '')
  const start = Date.now()
  const res = await fetch(`${httpUrl}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ tool: 'sessions_list', args: {} }),
    signal: AbortSignal.timeout(5000)
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { ok: boolean }
  if (!data.ok) throw new Error('Gateway returned ok=false')

  return { ok: true, latencyMs: Date.now() - start }
}

export async function getRepoPaths(): Promise<Record<string, string>> {
  return window.api.getRepoPaths()
}
