import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createCredentialService,
  _resetDefaultCredentialService,
  type ClaudeCredentialStore,
  type GithubCredentialStore
} from '../../services/credential-service'

describe('OAuth token cache — cache-hit path avoids disk reads', () => {
  beforeEach(() => {
    _resetDefaultCredentialService()
  })

  function makeGithubStore(): GithubCredentialStore {
    return {
      getEnvToken: vi.fn().mockReturnValue(null),
      detectCli: vi.fn().mockReturnValue(false),
      isAuthenticated: vi.fn().mockResolvedValue(false),
      isOptedOut: vi.fn().mockReturnValue(false)
    }
  }

  it('calls the underlying credential resolver only once across two rapid calls within the TTL window', async () => {
    const describeAuth = vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 60_000)
    })

    const claudeStore: ClaudeCredentialStore = {
      describeAuth,
      refreshFromKeychain: vi.fn().mockResolvedValue(true),
      readCachedToken: vi.fn().mockReturnValue('fake-oauth-token')
    }

    const service = createCredentialService({
      logger: console as never,
      claudeStore,
      githubStore: makeGithubStore()
    })

    // First call — resolves fresh from the store
    await service.getCredential('claude')
    expect(describeAuth).toHaveBeenCalledTimes(1)

    // Second call within TTL — must be served from the in-memory cache
    await service.getCredential('claude')
    expect(describeAuth).toHaveBeenCalledTimes(1)
  })

  it('invokes the underlying resolver again after the success-TTL window expires', async () => {
    vi.useFakeTimers()

    const describeAuth = vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt: null
    })

    const claudeStore: ClaudeCredentialStore = {
      describeAuth,
      refreshFromKeychain: vi.fn().mockResolvedValue(true),
      readCachedToken: vi.fn().mockReturnValue('fake-token')
    }

    const service = createCredentialService({
      logger: console as never,
      claudeStore,
      githubStore: makeGithubStore()
    })

    // First call — caches the result
    await service.getCredential('claude')
    expect(describeAuth).toHaveBeenCalledTimes(1)

    // Second call within TTL — cache hit
    await service.getCredential('claude')
    expect(describeAuth).toHaveBeenCalledTimes(1)

    // Advance past the 5-minute success TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    // Third call after TTL expiry — must re-resolve
    await service.getCredential('claude')
    expect(describeAuth).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})
