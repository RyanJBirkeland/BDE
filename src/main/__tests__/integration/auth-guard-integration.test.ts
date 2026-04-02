import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mock child_process and fs before imports ---

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false)
}))

import { checkAuthStatus, ensureSubscriptionAuth } from '../../auth-guard'
import type { CredentialStore } from '../../auth-guard'

// --- Helpers ---

/** Build an injected CredentialStore that returns a successful Keychain result.
 *  Using injected stores avoids the module-level rate-limit cache on MacOSCredentialStore. */
function makeKeychainStore(payload: Record<string, unknown>, cliFound = true): CredentialStore {
  return {
    readToken: async () => payload as ReturnType<typeof JSON.parse>,
    detectCli: () => cliFound
  }
}

/** Build an injected CredentialStore that fails (token not found). */
function makeFailingStore(cliFound = true): CredentialStore {
  return {
    readToken: async () => null,
    detectCli: () => cliFound
  }
}

describe('AuthGuard integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Restore any env vars we may have deleted
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_AUTH_TOKEN']
  })

  // ── checkAuthStatus ────────────────────────────────────────────────

  describe('checkAuthStatus', () => {
    it('returns all checks passing with valid token and CLI present', async () => {
      const futureMs = Date.now() + 3_600_000 // 1 hour from now
      const store = makeKeychainStore(
        {
          claudeAiOauth: {
            accessToken: 'valid-token-abc',
            expiresAt: String(futureMs)
          }
        },
        true
      )

      const status = await checkAuthStatus(store)

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(false)
      expect(status.expiresAt).toBeDefined()
      expect(status.expiresAt!.getTime()).toBe(futureMs)
    })

    it('returns tokenExpired=true when token has expired', async () => {
      const pastMs = Date.now() - 3_600_000 // 1 hour ago
      const store = makeKeychainStore(
        {
          claudeAiOauth: {
            accessToken: 'expired-token',
            expiresAt: String(pastMs)
          }
        },
        true
      )

      const status = await checkAuthStatus(store)

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(true)
    })

    it('returns cliFound=false when CLI is not installed', async () => {
      const store = makeKeychainStore(
        {
          claudeAiOauth: {
            accessToken: 'token',
            expiresAt: String(Date.now() + 3_600_000)
          }
        },
        false
      )

      const status = await checkAuthStatus(store)

      expect(status.cliFound).toBe(false)
      expect(status.tokenFound).toBe(true)
    })

    it('returns tokenFound=false when no Keychain entry exists', async () => {
      const store = makeFailingStore(true)

      const status = await checkAuthStatus(store)

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })

    it('returns tokenFound=false when Keychain has no accessToken', async () => {
      const store = makeKeychainStore(
        {
          claudeAiOauth: {
            // accessToken is missing
            expiresAt: String(Date.now() + 3_600_000)
          }
        },
        true
      )

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })

    it('returns tokenFound=false when Keychain payload has no claudeAiOauth', async () => {
      const store = makeKeychainStore({ someOtherKey: 'value' }, true)

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })
  })

  // ── ensureSubscriptionAuth ─────────────────────────────────────────

  describe('ensureSubscriptionAuth', () => {
    it('clears API key env vars on success', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'should-be-cleared'
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'should-also-be-cleared'

      const store = makeKeychainStore(
        {
          claudeAiOauth: {
            accessToken: 'valid-token',
            expiresAt: String(Date.now() + 3_600_000)
          }
        },
        true
      )

      await ensureSubscriptionAuth(store)

      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
    })

    it('throws when no token is found', async () => {
      const store = makeFailingStore(true)

      await expect(ensureSubscriptionAuth(store)).rejects.toThrow(
        'No Claude subscription token found'
      )
    })

    it('throws when token is expired', async () => {
      const store = makeKeychainStore(
        {
          claudeAiOauth: {
            accessToken: 'expired-token',
            expiresAt: String(Date.now() - 3_600_000)
          }
        },
        true
      )

      await expect(ensureSubscriptionAuth(store)).rejects.toThrow(
        'Claude subscription token expired'
      )
    })
  })

  // ── Auth failure prevents AgentManager from spawning ────────────────

  describe('auth failure blocks agent spawn', () => {
    it('ensureAuth rejection propagates to AgentManager runTask', async () => {
      // This test verifies the contract: when ensureAuth throws,
      // the AgentManager marks the task as error. We test via the
      // AgentManager integration test (agent-manager-integration.test.ts)
      // so here we just confirm the function signatures are correct.
      const store = makeFailingStore(true)
      const err = await ensureSubscriptionAuth(store).catch((e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('No Claude subscription token found')
    })
  })
})
