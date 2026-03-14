/**
 * Gateway RPC — proxied through the main process via IPC to avoid CORS.
 * window.api.invokeTool → IPC → main process fetch → gateway HTTP API
 */

/** @deprecated No longer needed with IPC-based RPC */
export function clearConfigCache(): void {
  // no-op — config is managed by the main process
}

export async function invokeTool(
  tool: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const data = (await window.api.invokeTool(tool, args)) as {
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
