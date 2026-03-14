let cachedConfig: { url: string; token: string } | null = null

async function getConfig(): Promise<{ url: string; token: string }> {
  if (!cachedConfig) cachedConfig = await window.api.getGatewayConfig()
  return cachedConfig
}

export function clearConfigCache(): void {
  cachedConfig = null
}

export async function invokeTool(
  tool: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const { url, token } = await getConfig()

  // Convert ws:// to http://
  const httpUrl = url.replace(/^wss?:\/\//, 'http://').replace(/\/$/, '')

  const res = await fetch(`${httpUrl}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ tool, args })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gateway error ${res.status}: ${err}`)
  }

  const data = (await res.json()) as {
    ok: boolean
    result?: { details?: unknown; content?: { type: string; text: string }[] }
    error?: string
  }

  if (!data.ok) throw new Error(data.error ?? 'Gateway returned ok=false')

  // Prefer details (pre-parsed), fall back to parsing content[0].text
  if (data.result?.details !== undefined) return data.result.details
  const text = data.result?.content?.[0]?.text
  if (text) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return data.result
}
