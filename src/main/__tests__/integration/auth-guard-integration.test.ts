import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mock child_process and fs before imports ---

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { checkAuthStatus, ensureSubscriptionAuth } from '../../auth-guard'

// --- Helpers ---

/** Mock execFile to return a successful Keychain result. */
function mockKeychainResult(payload: Record<string, unknown>) {
  vi.mocked(execFile).mockImplementation((...rawArgs: unknown[]) => {
    const cb = rawArgs[rawArgs.length - 1] as (
      err: Error | null,
      stdout?: string,
      stderr?: string,
    ) => void
    cb(null, JSON.stringify(payload), '')
    return {} as ReturnType<typeof execFile>
  })
}

/** Mock execFile to fail (token not found). */
function mockKeychainFailure() {
  vi.mocked(execFile).mockImplementation((...rawArgs: unknown[]) => {
    const cb = rawArgs[rawArgs.length - 1] as (err: Error | null) => void
    cb(new Error('security: SecKeychainSearchCopyNext: The specified item could not be found'))
    return {} as ReturnType<typeof execFile>
  })
}

/** Set CLI detection: true means at least one path has the claude binary. */
function mockCliExists(found: boolean) {
  vi.mocked(existsSync).mockReturnValue(found)
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
      mockCliExists(true)
      const futureMs = Date.now() + 3_600_000 // 1 hour from now
      mockKeychainResult({
        claudeAiOauth: {
          accessToken: 'valid-token-abc',
          expiresAt: String(futureMs),
        },
      })

      const status = await checkAuthStatus()

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(false)
      expect(status.expiresAt).toBeDefined()
      expect(status.expiresAt!.getTime()).toBe(futureMs)
    })

    it('returns tokenExpired=true when token has expired', async () => {
      mockCliExists(true)
      const pastMs = Date.now() - 3_600_000 // 1 hour ago
      mockKeychainResult({
        claudeAiOauth: {
          accessToken: 'expired-token',
          expiresAt: String(pastMs),
        },
      })

      const status = await checkAuthStatus()

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(true)
    })

    it('returns cliFound=false when CLI is not installed', async () => {
      mockCliExists(false)
      mockKeychainResult({
        claudeAiOauth: {
          accessToken: 'token',
          expiresAt: String(Date.now() + 3_600_000),
        },
      })

      const status = await checkAuthStatus()

      expect(status.cliFound).toBe(false)
      expect(status.tokenFound).toBe(true)
    })

    it('returns tokenFound=false when no Keychain entry exists', async () => {
      mockCliExists(true)
      mockKeychainFailure()

      const status = await checkAuthStatus()

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })

    it('returns tokenFound=false when Keychain has no accessToken', async () => {
      mockCliExists(true)
      mockKeychainResult({
        claudeAiOauth: {
          // accessToken is missing
          expiresAt: String(Date.now() + 3_600_000),
        },
      })

      const status = await checkAuthStatus()

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })

    it('returns tokenFound=false when Keychain payload has no claudeAiOauth', async () => {
      mockCliExists(true)
      mockKeychainResult({ someOtherKey: 'value' })

      const status = await checkAuthStatus()

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })
  })

  // ── ensureSubscriptionAuth ─────────────────────────────────────────

  describe('ensureSubscriptionAuth', () => {
    it('clears API key env vars on success', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'should-be-cleared'
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'should-also-be-cleared'

      mockCliExists(true)
      mockKeychainResult({
        claudeAiOauth: {
          accessToken: 'valid-token',
          expiresAt: String(Date.now() + 3_600_000),
        },
      })

      await ensureSubscriptionAuth()

      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
    })

    it('throws when no token is found', async () => {
      mockCliExists(true)
      mockKeychainFailure()

      await expect(ensureSubscriptionAuth()).rejects.toThrow(
        'No Claude subscription token found',
      )
    })

    it('throws when token is expired', async () => {
      mockCliExists(true)
      mockKeychainResult({
        claudeAiOauth: {
          accessToken: 'expired-token',
          expiresAt: String(Date.now() - 3_600_000),
        },
      })

      await expect(ensureSubscriptionAuth()).rejects.toThrow(
        'Claude subscription token expired',
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
      mockKeychainFailure()
      const err = await ensureSubscriptionAuth().catch((e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('No Claude subscription token found')
    })
  })
})
