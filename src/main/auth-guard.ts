/**
 * High-level subscription-auth gate. Delegates to `credential-service` for
 * the canonical guidance message, with a direct `checkAuthStatus` fallback
 * for tests that pass a custom store.
 */
import { checkAuthStatus, defaultCredentialStore, type CredentialStore } from './credential-store'
import { getDefaultCredentialService } from './services/credential-service'
import { createLogger } from './logger'

/**
 * Clears Anthropic API key env vars unconditionally at startup.
 * Calling this early in the startup sequence ensures pipeline agents and SDK
 * calls cannot accidentally pick up a raw API key from the environment —
 * BDE authenticates via the OAuth token written to ~/.bde/oauth-token instead.
 */
export function clearAnthropicEnvVars(): void {
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_AUTH_TOKEN']
}

export async function ensureSubscriptionAuth(
  store: CredentialStore = defaultCredentialStore
): Promise<void> {
  // DL-16: Clear env vars unconditionally to prevent bypass (even on error path)
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_AUTH_TOKEN']

  // When no custom store is passed, delegate to the shared credential service
  // so we produce the canonical CREDENTIAL_GUIDANCE message. Direct-store
  // callers (tests) keep the local path for backwards compatibility.
  if (store === defaultCredentialStore) {
    const service = getDefaultCredentialService(createLogger('auth-guard'))
    const result = await service.getCredential('claude')
    if (result.status !== 'ok') {
      throw new Error(result.actionable ?? `Claude credential unavailable (${result.status})`)
    }
    return
  }

  const status = await checkAuthStatus(store)

  if (!status.tokenFound) {
    throw new Error('No Claude subscription token found — run: claude login')
  }

  if (status.tokenExpired) {
    throw new Error('Claude subscription token expired — run: claude login')
  }
}
