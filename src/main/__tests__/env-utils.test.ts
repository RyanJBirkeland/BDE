import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ mode: 0o100600 })
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, execFile: vi.fn() }
})

import { getOAuthToken, invalidateOAuthToken, refreshOAuthTokenFromKeychain } from '../env-utils'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'

describe('OAuth token cache', () => {
  beforeEach(() => {
    invalidateOAuthToken()
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('invalidateOAuthToken forces next call to re-read from disk', () => {
    vi.mocked(readFileSync).mockReturnValue('token-v1')
    const t1 = getOAuthToken()
    expect(t1).toBe('token-v1')

    vi.mocked(readFileSync).mockReturnValue('token-v2')
    expect(getOAuthToken()).toBe('token-v1') // still cached

    invalidateOAuthToken()
    expect(getOAuthToken()).toBe('token-v2') // re-read
  })
})

describe('refreshOAuthTokenFromKeychain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateOAuthToken()
  })

  it('writes token file with mode 0o600', async () => {
    const fakeToken = 'fake-oauth-token-abc123'
    const credJson = JSON.stringify({ claudeAiOauth: { accessToken: fakeToken } })

    // execFile is callback-based; promisify wraps it — mock the callback form
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, { stdout: credJson, stderr: '' })
      return {} as any
    })

    const result = await refreshOAuthTokenFromKeychain()

    expect(result).toBe(true)
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('oauth-token'),
      fakeToken,
      { encoding: 'utf8', mode: 0o600 }
    )
  })

  it('returns false when security CLI fails', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error('security: tool not found'), { stdout: '', stderr: '' })
      return {} as any
    })

    const result = await refreshOAuthTokenFromKeychain()
    expect(result).toBe(false)
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
  })

  it('returns false when JSON has no accessToken', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, { stdout: JSON.stringify({ claudeAiOauth: {} }), stderr: '' })
      return {} as any
    })

    const result = await refreshOAuthTokenFromKeychain()
    expect(result).toBe(false)
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
  })

  describe('OAuth refresh when accessToken is expired', () => {
    const ORIG_FETCH = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = ORIG_FETCH
    })

    /**
     * Helper: stub execFile so it differentiates between
     *  - `find-generic-password` (keychain read) → returns the provided creds JSON
     *  - `add-generic-password`  (keychain write) → records the call and succeeds
     * Returns the array of write calls so tests can assert on them.
     */
    function stubKeychain(initialCreds: object): { writes: string[] } {
      const writes: string[] = []
      vi.mocked(execFile).mockImplementation((_cmd, args: any, _opts, callback: any) => {
        const argv = Array.isArray(args) ? args : []
        if (argv[0] === 'find-generic-password') {
          callback(null, { stdout: JSON.stringify(initialCreds) + '\n', stderr: '' })
        } else if (argv[0] === 'add-generic-password') {
          // The new creds JSON is the value passed after the `-w` flag
          const wIdx = argv.indexOf('-w')
          if (wIdx >= 0 && argv[wIdx + 1]) writes.push(argv[wIdx + 1])
          callback(null, { stdout: '', stderr: '' })
        } else {
          callback(new Error('unexpected security args: ' + argv.join(' ')), {
            stdout: '',
            stderr: ''
          })
        }
        return {} as any
      })
      return { writes }
    }

    it('does not call fetch when accessToken is still valid (>5min until expiry)', async () => {
      const validUntilMs = Date.now() + 60 * 60 * 1000 // 1 hour from now
      stubKeychain({
        claudeAiOauth: {
          accessToken: 'still-valid-token-123',
          refreshToken: 'r-tok',
          expiresAt: String(validUntilMs)
        }
      })
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy as unknown as typeof fetch

      const result = await refreshOAuthTokenFromKeychain()

      expect(result).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('oauth-token'),
        'still-valid-token-123',
        expect.objectContaining({ mode: 0o600 })
      )
    })

    it('calls OAuth refresh endpoint and writes new token + updates keychain when expired', async () => {
      const expiredAtMs = Date.now() - 60 * 1000 // 1 minute ago
      const { writes } = stubKeychain({
        claudeAiOauth: {
          accessToken: 'old-expired-token',
          refreshToken: 'old-refresh-token',
          expiresAt: String(expiredAtMs)
        }
      })

      const newExpiresInSec = 3600
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh-access-token-xyz',
          refresh_token: 'rotated-refresh-token',
          expires_in: newExpiresInSec
        })
      }) as unknown as typeof fetch

      const result = await refreshOAuthTokenFromKeychain()

      expect(result).toBe(true)

      // The OAuth endpoint should have been called with the OLD refresh_token
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://console.anthropic.com/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: expect.stringContaining('"refresh_token":"old-refresh-token"')
        })
      )

      // The file should contain the FRESH access token, not the old one
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('oauth-token'),
        'fresh-access-token-xyz',
        expect.objectContaining({ mode: 0o600 })
      )

      // The keychain write should have happened, with the rotated refresh_token
      expect(writes.length).toBe(1)
      const written = JSON.parse(writes[0])
      expect(written.claudeAiOauth.accessToken).toBe('fresh-access-token-xyz')
      expect(written.claudeAiOauth.refreshToken).toBe('rotated-refresh-token')
      // expiresAt should be roughly now + expires_in*1000, stored as a string of ms
      const writtenExpiresAt = parseInt(written.claudeAiOauth.expiresAt, 10)
      expect(writtenExpiresAt).toBeGreaterThan(Date.now() + (newExpiresInSec - 10) * 1000)
      expect(writtenExpiresAt).toBeLessThan(Date.now() + (newExpiresInSec + 10) * 1000)
    })

    it('refreshes when within the 5-minute buffer even if not strictly expired', async () => {
      const aboutToExpire = Date.now() + 60 * 1000 // 1 minute from now (inside 5min buffer)
      stubKeychain({
        claudeAiOauth: {
          accessToken: 'about-to-expire',
          refreshToken: 'r-tok',
          expiresAt: String(aboutToExpire)
        }
      })
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'newly-minted',
          refresh_token: 'r-tok-2',
          expires_in: 3600
        })
      }) as unknown as typeof fetch

      const result = await refreshOAuthTokenFromKeychain()

      expect(result).toBe(true)
      expect(globalThis.fetch).toHaveBeenCalled()
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('oauth-token'),
        'newly-minted',
        expect.objectContaining({ mode: 0o600 })
      )
    })

    it('falls back to writing the existing token if OAuth refresh fails', async () => {
      const expiredAtMs = Date.now() - 60 * 1000
      stubKeychain({
        claudeAiOauth: {
          accessToken: 'old-token-still-better-than-nothing',
          refreshToken: 'r-tok',
          expiresAt: String(expiredAtMs)
        }
      })
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' })
      }) as unknown as typeof fetch

      const result = await refreshOAuthTokenFromKeychain()

      // Refresh failed but we still wrote the old token — caller will surface
      // the 401 if it really is expired, which is more visible than silently
      // failing here. Returning true keeps the current pattern for callers.
      expect(result).toBe(true)
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('oauth-token'),
        'old-token-still-better-than-nothing',
        expect.objectContaining({ mode: 0o600 })
      )
    })

    it('does not call OAuth endpoint when there is no refresh token in keychain', async () => {
      const expiredAtMs = Date.now() - 60 * 1000
      stubKeychain({
        claudeAiOauth: {
          accessToken: 'expired-no-refresh',
          // refreshToken intentionally missing
          expiresAt: String(expiredAtMs)
        }
      })
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy as unknown as typeof fetch

      const result = await refreshOAuthTokenFromKeychain()

      expect(result).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled()
    })
  })
})
