import { safeHandle } from '../ipc-utils'
import { checkAuthStatus } from '../auth-guard'

export function registerAuthHandlers(): void {
  safeHandle('auth:status', async () => {
    const status = await checkAuthStatus()
    return {
      cliFound: status.cliFound,
      tokenFound: status.tokenFound,
      tokenExpired: status.tokenExpired,
      expiresAt: status.expiresAt?.toISOString()
    }
  })
}
