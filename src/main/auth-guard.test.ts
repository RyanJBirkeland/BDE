import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawnSync: vi.fn()
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn()
}))

import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { checkAuthStatus, ensureSubscriptionAuth, MacOSCredentialStore } from './auth-guard'
import type { CredentialStore } from './auth-guard'

// Helper: find the callback in execFile's variadic args.
type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void

function findCallback(...args: unknown[]): ExecFileCallback {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') return args[i] as ExecFileCallback
  }
  throw new Error('No callback found in execFile args')
}

// Helper to make the mocked execFile resolve with a value (used by MacOSCredentialStore tests)
function mockExecFileResult(stdout: string): void {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const cb = findCallback(...args)
    cb(null, stdout, '')
  }) as typeof execFile)
}

// Helper to make the mocked execFile reject with an error (used by MacOSCredentialStore tests)
function mockExecFileError(message: string): void {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const cb = findCallback(...args)
    cb(new Error(message), '', '')
  }) as typeof execFile)
}

function makeKeychainJson(overrides: Partial<{ accessToken: string; expiresAt: string }> = {}) {
  const defaults = {
    accessToken: 'test-token-abc',
    expiresAt: String(Date.now() + 3600_000) // 1 hour from now
  }
  const oauth = { ...defaults, ...overrides }
  return JSON.stringify({ claudeAiOauth: oauth })
}

// Build an injected CredentialStore from a keychain JSON string.
// Using injected stores avoids the module-level rate-limit cache on MacOSCredentialStore.
function makeStore(keychainJson: string, cliFound = true): CredentialStore {
  return {
    readToken: async () => JSON.parse(keychainJson) as ReturnType<typeof JSON.parse>,
    detectCli: () => cliFound
  }
}

// Build an injected CredentialStore that returns null (token not found)
function makeFailingStore(): CredentialStore {
  return {
    readToken: async () => null,
    detectCli: () => true
  }
}

describe('auth-guard', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.clearAllMocks()
    savedEnv = { ...process.env }
    // Default: spawnSync which-probe succeeds (CLI found), existsSync fallback also succeeds
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: '/usr/local/bin/claude\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
      error: undefined
    })
    vi.mocked(existsSync).mockReturnValue(true)
  })

  afterEach(() => {
    process.env = savedEnv
  })

  describe('checkAuthStatus', () => {
    it('returns all checks passing with valid token', async () => {
      const futureMs = Date.now() + 3600_000
      const store = makeStore(makeKeychainJson({ expiresAt: String(futureMs) }))

      const status = await checkAuthStatus(store)

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(false)
      expect(status.expiresAt).toBeInstanceOf(Date)
      expect(status.expiresAt!.getTime()).toBe(futureMs)
    })

    it('returns tokenExpired: true when expiresAt is in the past', async () => {
      const pastMs = Date.now() - 3600_000
      const store = makeStore(makeKeychainJson({ expiresAt: String(pastMs) }))

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(true)
      expect(status.expiresAt).toBeInstanceOf(Date)
      expect(status.expiresAt!.getTime()).toBe(pastMs)
    })

    it('returns tokenFound: false when keychain has no entry', async () => {
      const store = makeFailingStore()

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
      expect(status.expiresAt).toBeUndefined()
    })

    it('returns cliFound: false when no CLI binary exists', async () => {
      const futureMs = Date.now() + 3600_000
      const store = makeStore(makeKeychainJson({ expiresAt: String(futureMs) }), false)

      const status = await checkAuthStatus(store)

      expect(status.cliFound).toBe(false)
    })

    it('returns tokenFound: false when JSON has no claudeAiOauth', async () => {
      const store: CredentialStore = {
        readToken: async () => ({ someOtherKey: {} }) as never,
        detectCli: () => true
      }

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })

    it('returns tokenFound: false when claudeAiOauth has no accessToken', async () => {
      const store: CredentialStore = {
        readToken: async () => ({ claudeAiOauth: { expiresAt: '9999999999999' } }),
        detectCli: () => true
      }

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(false)
    })

    it('reports tokenExpired when expiresAt is missing', async () => {
      const store: CredentialStore = {
        readToken: async () => ({ claudeAiOauth: { accessToken: 'tok' } }),
        detectCli: () => true
      }
      const status = await checkAuthStatus(store)
      expect(status.tokenExpired).toBe(true)
    })
  })

  describe('ensureSubscriptionAuth', () => {
    it('throws when no token found', async () => {
      const store = makeFailingStore()

      await expect(ensureSubscriptionAuth(store)).rejects.toThrow()
    })

    it('throws when token is expired', async () => {
      const pastMs = Date.now() - 3600_000
      const store = makeStore(makeKeychainJson({ expiresAt: String(pastMs) }))

      await expect(ensureSubscriptionAuth(store)).rejects.toThrow()
    })

    it('clears ANTHROPIC_API_KEY from env', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'should-be-removed'
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'also-removed'
      const store = makeStore(makeKeychainJson())

      await ensureSubscriptionAuth(store)

      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
    })

    it('does not throw when token is valid', async () => {
      const store = makeStore(makeKeychainJson())

      await expect(ensureSubscriptionAuth(store)).resolves.not.toThrow()
    })
  })

  describe('MacOSCredentialStore', () => {
    let fakeNow: number

    beforeEach(() => {
      vi.useFakeTimers()
      // Each test advances time by 2s to bypass the 1s rate-limit cache on readToken()
      fakeNow = (fakeNow ?? Date.now()) + 2000
      vi.setSystemTime(fakeNow)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('reads token via execFile (security command)', async () => {
      mockExecFileResult(makeKeychainJson())
      const store = new MacOSCredentialStore()
      const payload = await store.readToken()
      expect(payload).not.toBeNull()
      expect(payload?.claudeAiOauth?.accessToken).toBe('test-token-abc')
    })

    it('returns null when security command fails', async () => {
      vi.setSystemTime(Date.now() + 5000) // ensure rate limit has expired
      mockExecFileError('security: item not found')
      const store = new MacOSCredentialStore()
      const payload = await store.readToken()
      expect(payload).toBeNull()
    })

    it('returns null when keychain payload is not valid JSON', async () => {
      vi.setSystemTime(Date.now() + 5000)
      mockExecFileResult('not json at all')
      const store = new MacOSCredentialStore()
      const payload = await store.readToken()
      expect(payload).toBeNull()
    })

    it('returns null when keychain payload has wrong field types', async () => {
      vi.setSystemTime(Date.now() + 5000)
      // accessToken should be a string; number should be rejected by the schema
      mockExecFileResult(JSON.stringify({ claudeAiOauth: { accessToken: 123 } }))
      const store = new MacOSCredentialStore()
      const payload = await store.readToken()
      expect(payload).toBeNull()
    })

    it('detects CLI via which probe', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: '/usr/local/bin/claude\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
        error: undefined
      })
      const store = new MacOSCredentialStore()
      expect(store.detectCli()).toBe(true)
    })

    it('falls back to existsSync when which is unavailable', () => {
      // which probe fails (e.g., /usr/bin/which not present)
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
        error: undefined
      })
      vi.mocked(existsSync).mockReturnValue(true)
      const store = new MacOSCredentialStore()
      expect(store.detectCli()).toBe(true)
    })

    it('returns false when CLI not found via which or existsSync', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
        error: undefined
      })
      vi.mocked(existsSync).mockReturnValue(false)
      const store = new MacOSCredentialStore()
      expect(store.detectCli()).toBe(false)
    })
  })
})
