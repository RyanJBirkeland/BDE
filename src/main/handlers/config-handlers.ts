import { safeHandle } from '../ipc-utils'
import { getGatewayConfig, getGitHubToken, saveGatewayConfig, getSupabaseConfig } from '../config'

export function registerConfigHandlers(): void {
  let gatewayConfig: { url: string; token: string }
  try {
    gatewayConfig = getGatewayConfig()
  } catch {
    return
  }

  safeHandle('get-gateway-config', () => gatewayConfig)
  // TODO: AX-S1 — add 'get-github-token' to IpcChannelMap
  safeHandle('get-github-token', () => getGitHubToken())
  safeHandle('save-gateway-config', (_e, url: string, token: string) => {
    saveGatewayConfig(url, token)
    gatewayConfig = { url, token }
  })
  // TODO: AX-S1 — add 'get-supabase-config' to IpcChannelMap
  safeHandle('get-supabase-config', () => getSupabaseConfig())
}
