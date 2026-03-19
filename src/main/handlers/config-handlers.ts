import { safeHandle } from '../ipc-utils'
import { getGatewayConfig, saveGatewayConfig } from '../config'

export function registerConfigHandlers(): void {
  safeHandle('config:getGatewayUrl', () => {
    try {
      const { url, token } = getGatewayConfig()
      return { url, hasToken: !!token }
    } catch {
      return { url: '', hasToken: false }
    }
  })
  safeHandle('config:saveGateway', (_e, url: string, token?: string) => {
    if (token) {
      saveGatewayConfig(url, token)
    } else {
      // Preserve existing token when only URL is updated
      try {
        const existing = getGatewayConfig()
        saveGatewayConfig(url, existing.token)
      } catch {
        // No existing config — cannot save without a token
        throw new Error('Cannot save gateway config: no token provided and no existing token found')
      }
    }
  })
}
