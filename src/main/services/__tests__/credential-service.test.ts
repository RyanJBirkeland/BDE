import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createCredentialService,
  CREDENTIAL_GUIDANCE,
  type ClaudeCredentialStore,
  type GithubCredentialStore
} from '../credential-service'
import type { Logger } from '../../logger'

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  } as unknown as Logger
}

function makeClaudeStore(overrides: Partial<ClaudeCredentialStore> = {}): ClaudeCredentialStore {
  return {
    readCachedToken: vi.fn().mockReturnValue('a-valid-oauth-token-long-enough'),
    refreshFromKeychain: vi.fn().mockResolvedValue(true),
    describeAuth: vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    }),
    ...overrides
  }
}

function makeGithubStore(overrides: Partial<GithubCredentialStore> = {}): GithubCredentialStore {
  return {
    getEnvToken: vi.fn().mockReturnValue(null),
    detectCli: vi.fn().mockReturnValue(true),
    isAuthenticated: vi.fn().mockResolvedValue(true),
    isOptedOut: vi.fn().mockReturnValue(false),
    ...overrides
  }
}

describe('CredentialService — Claude', () => {
  let logger: Logger
  beforeEach(() => {
    logger = makeLogger()
  })

  it('returns ok when CLI, token, and expiry are all valid', async () => {
    const service = createCredentialService({ logger, claudeStore: makeClaudeStore() })
    const result = await service.getCredential('claude')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.token).toBe('a-valid-oauth-token-long-enough')
      expect(result.cliFound).toBe(true)
      expect(result.expiresAt).toBeInstanceOf(Date)
    }
  })

  it('returns cli-missing when CLI is not found', async () => {
    const store = makeClaudeStore({
      describeAuth: vi
        .fn()
        .mockResolvedValue({ cliFound: false, tokenFound: false, tokenExpired: false })
    })
    const service = createCredentialService({ logger, claudeStore: store })
    const result = await service.getCredential('claude')
    expect(result.status).toBe('cli-missing')
    if (result.status !== 'ok') {
      expect(result.actionable).toBe(CREDENTIAL_GUIDANCE.claude['cli-missing'])
      expect(result.cliFound).toBe(false)
    }
  })

  it('returns missing when CLI exists but no token on disk and no Keychain', async () => {
    const store = makeClaudeStore({
      readCachedToken: vi.fn().mockReturnValue(null),
      refreshFromKeychain: vi.fn().mockResolvedValue(false),
      describeAuth: vi
        .fn()
        .mockResolvedValue({ cliFound: true, tokenFound: false, tokenExpired: false })
    })
    const service = createCredentialService({ logger, claudeStore: store })
    const result = await service.getCredential('claude')
    expect(result.status).toBe('missing')
    if (result.status !== 'ok') {
      expect(result.actionable).toBe('Run: claude login')
    }
  })

  it('returns expired when token is known-stale', async () => {
    const store = makeClaudeStore({
      describeAuth: vi.fn().mockResolvedValue({
        cliFound: true,
        tokenFound: true,
        tokenExpired: true,
        expiresAt: new Date(Date.now() - 1000)
      })
    })
    const service = createCredentialService({ logger, claudeStore: store })
    const result = await service.getCredential('claude')
    expect(result.status).toBe('expired')
    if (result.status !== 'ok') {
      expect(result.actionable).toContain('claude login')
    }
  })

  it('refreshes from Keychain before reading the token file', async () => {
    const refresh = vi.fn().mockResolvedValue(true)
    const store = makeClaudeStore({ refreshFromKeychain: refresh })
    const service = createCredentialService({ logger, claudeStore: store })
    await service.getCredential('claude')
    expect(refresh).toHaveBeenCalled()
  })

  it('caches a successful result for subsequent calls', async () => {
    const describe = vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 60_000)
    })
    const service = createCredentialService({
      logger,
      claudeStore: makeClaudeStore({ describeAuth: describe })
    })
    await service.getCredential('claude')
    await service.getCredential('claude')
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('refreshCredential bypasses the cache', async () => {
    const describe = vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 60_000)
    })
    const service = createCredentialService({
      logger,
      claudeStore: makeClaudeStore({ describeAuth: describe })
    })
    await service.getCredential('claude')
    await service.refreshCredential('claude')
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('invalidateCache forces the next getCredential to re-read', async () => {
    const describe = vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 60_000)
    })
    const service = createCredentialService({
      logger,
      claudeStore: makeClaudeStore({ describeAuth: describe })
    })
    await service.getCredential('claude')
    service.invalidateCache('claude')
    await service.getCredential('claude')
    expect(describe).toHaveBeenCalledTimes(2)
  })
})

describe('CredentialService — GitHub', () => {
  let logger: Logger
  beforeEach(() => {
    logger = makeLogger()
  })

  it('returns ok when GH_TOKEN is set, without touching gh CLI', async () => {
    const isAuthenticated = vi.fn().mockResolvedValue(false)
    const store = makeGithubStore({
      getEnvToken: vi.fn().mockReturnValue('ghp_thisisafaketokenthatislongenoughtopass'),
      isAuthenticated
    })
    const service = createCredentialService({ logger, githubStore: store })
    const result = await service.getCredential('github')
    expect(result.status).toBe('ok')
    expect(isAuthenticated).not.toHaveBeenCalled()
  })

  it('returns cli-missing when gh binary is absent and no env token', async () => {
    const store = makeGithubStore({
      detectCli: vi.fn().mockReturnValue(false)
    })
    const service = createCredentialService({ logger, githubStore: store })
    const result = await service.getCredential('github')
    expect(result.status).toBe('cli-missing')
  })

  it('returns missing when gh CLI exists but user is not authenticated', async () => {
    const store = makeGithubStore({
      isAuthenticated: vi.fn().mockResolvedValue(false)
    })
    const service = createCredentialService({ logger, githubStore: store })
    const result = await service.getCredential('github')
    expect(result.status).toBe('missing')
    if (result.status !== 'ok') {
      expect(result.actionable).toBe('Run: gh auth login')
    }
  })

  it('returns missing with null actionable when opted out', async () => {
    const store = makeGithubStore({
      isOptedOut: vi.fn().mockReturnValue(true)
    })
    const service = createCredentialService({ logger, githubStore: store })
    const result = await service.getCredential('github')
    expect(result.status).toBe('missing')
    if (result.status !== 'ok') {
      expect(result.actionable).toBe(null)
    }
  })

  it('returns ok with placeholder token when gh is authenticated', async () => {
    const service = createCredentialService({ logger, githubStore: makeGithubStore() })
    const result = await service.getCredential('github')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.token).toBe('gh-managed')
    }
  })
})
