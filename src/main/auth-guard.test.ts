import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawnSync: vi.fn()
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn()
}))

// env-utils imports the logger (which touches the filesystem at module load
// to ensure ~/.fleet exists). Mock the only export auth-guard consumes — the
// file-based OAuth token reader — so the test stays hermetic.
vi.mock('./env-utils', () => ({
  getOAuthToken: vi.fn().mockReturnValue(null)
}))

// auth-guard now imports credential-service, which transitively loads
// settings-queries.ts — and its module-scope `createLogger()` call writes to
// ~/.fleet at import time. Mock the logger module so the test stays hermetic
// regardless of which path reaches it.
vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  logError: vi.fn()
}))

import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { checkAuthStatus, MacOSCredentialStore } from './credential-store'
import type { CredentialStore } from './credential-store'
import { ensureSubscriptionAuth } from './auth-guard'

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
function makeStore(
  keychainJson: string,
  cliFound = true,
  fileToken: string | null = null
): CredentialStore {
  return {
    readToken: async () => JSON.parse(keychainJson) as ReturnType<typeof JSON.parse>,
    readFileToken: () => fileToken,
    detectCli: () => cliFound
  }
}

// Build an injected CredentialStore that returns null from Keychain.
// `fileToken` simulates the `~/.fleet/oauth-token` fallback.
function makeFailingStore(fileToken: string | null = null): CredentialStore {
  return {
    readToken: async () => null,
    readFileToken: () => fileToken,
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
        readFileToken: () => null,
        detectCli: () => true
      }

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })

    it('returns tokenFound: false when claudeAiOauth has no accessToken', async () => {
      const store: CredentialStore = {
        readToken: async () => ({ claudeAiOauth: { expiresAt: '9999999999999' } }),
        readFileToken: () => null,
        detectCli: () => true
      }

      const status = await checkAuthStatus(store)

      expect(status.tokenFound).toBe(false)
    })

    it('reports tokenExpired when expiresAt is missing', async () => {
      const store: CredentialStore = {
        readToken: async () => ({ claudeAiOauth: { accessToken: 'tok' } }),
        readFileToken: () => null,
        detectCli: () => true
      }
      const status = await checkAuthStatus(store)
      expect(status.tokenExpired).toBe(true)
    })

    describe('file-based fallback', () => {
      it('returns tokenFound: true when keychain returns null but file token exists', async () => {
        // Pins the fix for unsigned/newly-installed bundles whose code identity
        // isn't on the keychain ACL: the UI falls back to the same file token
        // the agent manager uses at spawn time, so onboarding can progress.
        const store = makeFailingStore('sk-ant-oat01-from-disk-fallback')

        const status = await checkAuthStatus(store)

        expect(status.tokenFound).toBe(true)
        expect(status.tokenExpired).toBe(false)
        expect(status.expiresAt).toBeUndefined()
      })

      it('returns tokenFound: false when keychain null AND file token absent', async () => {
        const store = makeFailingStore(null)

        const status = await checkAuthStatus(store)

        expect(status.tokenFound).toBe(false)
        expect(status.tokenExpired).toBe(false)
      })

      it('falls back to file token when keychain payload has no accessToken', async () => {
        // Keychain returns a payload but with missing accessToken (malformed
        // entry, partial write, etc.). File token is still a valid fallback.
        const store: CredentialStore = {
          readToken: async () => ({ claudeAiOauth: { expiresAt: '9999999999999' } }),
          readFileToken: () => 'sk-ant-oat01-from-disk-fallback',
          detectCli: () => true
        }

        const status = await checkAuthStatus(store)

        expect(status.tokenFound).toBe(true)
        expect(status.tokenExpired).toBe(false)
      })

      it('prefers keychain data when both keychain and file are available', async () => {
        // Happy path for signed/authorized apps: keychain wins because it
        // carries expiry metadata the file doesn't have.
        const futureMs = Date.now() + 3600_000
        const store = makeStore(
          makeKeychainJson({ expiresAt: String(futureMs) }),
          true,
          'sk-ant-oat01-ignored-because-keychain-wins'
        )

        const status = await checkAuthStatus(store)

        expect(status.tokenFound).toBe(true)
        expect(status.tokenExpired).toBe(false)
        expect(status.expiresAt?.getTime()).toBe(futureMs)
      })
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
