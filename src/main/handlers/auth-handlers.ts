import { safeHandle } from '../ipc-utils'
import { checkAuthStatus } from '../auth-guard'
import { execFileAsync } from '../lib/async-utils'

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

export function registerOnboardingHandlers(): void {
  safeHandle('onboarding:checkGhCli', async () => {
    try {
      const { stdout } = await execFileAsync('gh', ['--version'])
      const version = stdout.trim().split('\n')[0] ?? undefined
      // Check authentication separately — `gh` installed but not logged in causes silent PR failures
      try {
        await execFileAsync('gh', ['auth', 'status'])
        return { available: true, authenticated: true, version }
      } catch {
        return { available: true, authenticated: false, version }
      }
    } catch {
      return { available: false, authenticated: false }
    }
  })
}
