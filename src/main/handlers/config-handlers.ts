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
  safeHandle('get-github-token', () => getGitHubToken())
  safeHandle('save-gateway-config', (_e, url: string, token: string) => {
    saveGatewayConfig(url, token)
    gatewayConfig = { url, token }
  })
  safeHandle('get-supabase-config', () => getSupabaseConfig())
}
