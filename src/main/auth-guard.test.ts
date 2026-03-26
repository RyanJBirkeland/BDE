import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock child_process.execFile before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn()
}))

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { checkAuthStatus, ensureSubscriptionAuth } from './auth-guard'
import type { CredentialStore } from './auth-guard'

// Helper: find the callback in execFile's variadic args.
// promisify calls execFile(cmd, args, cb) or execFile(cmd, args, opts, cb).
type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void

function findCallback(...args: unknown[]): ExecFileCallback {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') return args[i] as ExecFileCallback
  }
  throw new Error('No callback found in execFile args')
}

// Helper to make the mocked execFile resolve with a value
function mockExecFileResult(stdout: string): void {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const cb = findCallback(...args)
    cb(null, stdout, '')
  }) as typeof execFile)
}

// Helper to make the mocked execFile reject with an error
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

describe('auth-guard', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.clearAllMocks()
    savedEnv = { ...process.env }
    // By default, CLI binary is found
    vi.mocked(existsSync).mockReturnValue(true)
  })

  afterEach(() => {
    process.env = savedEnv
  })

  describe('checkAuthStatus', () => {
    it('returns all checks passing with valid token', async () => {
      const futureMs = Date.now() + 3600_000
      mockExecFileResult(makeKeychainJson({ expiresAt: String(futureMs) }))

      const status = await checkAuthStatus()

      expect(status.cliFound).toBe(true)
      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(false)
      expect(status.expiresAt).toBeInstanceOf(Date)
      expect(status.expiresAt!.getTime()).toBe(futureMs)
    })

    it('returns tokenExpired: true when expiresAt is in the past', async () => {
      const pastMs = Date.now() - 3600_000
      mockExecFileResult(makeKeychainJson({ expiresAt: String(pastMs) }))

      const status = await checkAuthStatus()

      expect(status.tokenFound).toBe(true)
      expect(status.tokenExpired).toBe(true)
      expect(status.expiresAt).toBeInstanceOf(Date)
      expect(status.expiresAt!.getTime()).toBe(pastMs)
    })

    it('returns tokenFound: false when keychain has no entry', async () => {
      mockExecFileError(
        'security: SecKeychainSearchCopyNext: The specified item could not be found'
      )

      const status = await checkAuthStatus()

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
      expect(status.expiresAt).toBeUndefined()
    })

    it('returns cliFound: false when no CLI binary exists', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      mockExecFileResult(makeKeychainJson())

      const status = await checkAuthStatus()

      expect(status.cliFound).toBe(false)
    })

    it('returns tokenFound: false when JSON has no claudeAiOauth', async () => {
      mockExecFileResult(JSON.stringify({ someOtherKey: {} }))

      const status = await checkAuthStatus()

      expect(status.tokenFound).toBe(false)
      expect(status.tokenExpired).toBe(false)
    })

    it('returns tokenFound: false when claudeAiOauth has no accessToken', async () => {
      mockExecFileResult(JSON.stringify({ claudeAiOauth: { expiresAt: '9999999999999' } }))

      const status = await checkAuthStatus()

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
      mockExecFileError('security: item not found')

      await expect(ensureSubscriptionAuth()).rejects.toThrow()
    })

    it('throws when token is expired', async () => {
      const pastMs = Date.now() - 3600_000
      mockExecFileResult(makeKeychainJson({ expiresAt: String(pastMs) }))

      await expect(ensureSubscriptionAuth()).rejects.toThrow()
    })

    it('clears ANTHROPIC_API_KEY from env', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'should-be-removed'
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'also-removed'
      mockExecFileResult(makeKeychainJson())

      await ensureSubscriptionAuth()

      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
    })

    it('does not throw when token is valid', async () => {
      mockExecFileResult(makeKeychainJson())

      await expect(ensureSubscriptionAuth()).resolves.not.toThrow()
    })
  })
})
