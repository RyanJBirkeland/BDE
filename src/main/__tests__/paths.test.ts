/**
 * paths.ts — validation guards for path-sensitive settings, and env var overrides
 *
 * Security: validateWorktreeBase and validateTestDbPath prevent path traversal
 * by ensuring values stay within expected filesystem boundaries.
 *
 * Env vars: BDE_DATA_DIR overrides BDE_DIR; BDE_DB_PATH overrides the DB location
 * (lower priority than BDE_TEST_DB which is used by the test suite itself).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

import { validateWorktreeBase, validateTestDbPath } from '../paths'

// ---------------------------------------------------------------------------
// Env var overrides — BDE_DATA_DIR, BDE_DB_PATH
// These constants are evaluated at module-load time. We use vi.resetModules()
// + dynamic import so each test gets a fresh module evaluation with the env
// vars set before the import.
// ---------------------------------------------------------------------------

describe('paths env var overrides', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.BDE_DATA_DIR
    delete process.env.BDE_DB_PATH
  })

  it('BDE_DIR defaults to ~/.bde when BDE_DATA_DIR is not set', async () => {
    vi.resetModules()
    const mod = await import('../paths')
    expect(mod.BDE_DIR).toBe(join(homedir(), '.bde'))
  })

  it('BDE_DIR uses BDE_DATA_DIR env var when set', async () => {
    process.env.BDE_DATA_DIR = '/tmp/custom-bde-dir'
    vi.resetModules()
    const mod = await import('../paths')
    expect(mod.BDE_DIR).toBe('/tmp/custom-bde-dir')
  })

  it('BDE_DB_PATH uses BDE_DB_PATH env var when BDE_TEST_DB is not set', async () => {
    // BDE_TEST_DB takes priority over BDE_DB_PATH (used by the test suite itself).
    // Temporarily unset it to verify BDE_DB_PATH is honoured when TEST_DB is absent.
    const savedTestDb = process.env.BDE_TEST_DB
    delete process.env.BDE_TEST_DB
    process.env.BDE_DB_PATH = '/tmp/custom.db'
    vi.resetModules()
    try {
      const mod = await import('../paths')
      expect(mod.BDE_DB_PATH).toBe('/tmp/custom.db')
    } finally {
      process.env.BDE_TEST_DB = savedTestDb
      vi.resetModules()
    }
  })
})

// ---------------------------------------------------------------------------
// validateWorktreeBase
// ---------------------------------------------------------------------------

describe('validateWorktreeBase', () => {
  it('accepts a path inside the user home directory', () => {
    const safe = join(homedir(), 'worktrees', 'bde')
    expect(() => validateWorktreeBase(safe)).not.toThrow()
  })

  it('accepts a path directly under home', () => {
    const safe = join(homedir(), 'my-worktrees')
    expect(() => validateWorktreeBase(safe)).not.toThrow()
  })

  it('rejects /etc — system directory outside home', () => {
    expect(() => validateWorktreeBase('/etc/malicious')).toThrow(/home directory/i)
  })

  it('rejects /tmp — not in home directory', () => {
    expect(() => validateWorktreeBase('/tmp/bad')).toThrow(/home directory/i)
  })

  it('rejects /var/root path traversal attempt', () => {
    expect(() => validateWorktreeBase('/var/root/worktrees')).toThrow(/home directory/i)
  })

  it('rejects a path that starts with homedir string but escapes via traversal', () => {
    // e.g. homedir() is /Users/ryan, this tries /Users/ryanevil
    const tricky = homedir() + 'evil/worktrees'
    // Only valid if it starts with homedir() + '/'
    expect(() => validateWorktreeBase(tricky)).toThrow(/home directory/i)
  })

  it('rejects empty string', () => {
    expect(() => validateWorktreeBase('')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// validateTestDbPath
// ---------------------------------------------------------------------------

describe('validateTestDbPath', () => {
  it('accepts :memory: (SQLite in-memory database)', () => {
    expect(() => validateTestDbPath(':memory:')).not.toThrow()
  })

  it('accepts a path in /tmp', () => {
    expect(() => validateTestDbPath('/tmp/test.db')).not.toThrow()
  })

  it.skipIf(process.platform !== 'darwin')(
    'accepts a path in /private/tmp (macOS real tmpdir)',
    () => {
      expect(() => validateTestDbPath('/private/tmp/test.db')).not.toThrow()
    }
  )

  it('accepts undefined (BDE_TEST_DB not set)', () => {
    expect(() => validateTestDbPath(undefined)).not.toThrow()
  })

  it('rejects /etc/passwd', () => {
    expect(() => validateTestDbPath('/etc/passwd')).toThrow(/tmp/i)
  })

  it('rejects a home directory path', () => {
    expect(() => validateTestDbPath(join(homedir(), 'sneaky.db'))).toThrow(/tmp/i)
  })

  it('rejects a root-level path', () => {
    expect(() => validateTestDbPath('/bde.db')).toThrow(/tmp/i)
  })
})
