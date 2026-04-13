/**
 * paths.ts — validation guards for path-sensitive settings
 *
 * Security: validateWorktreeBase and validateTestDbPath prevent path traversal
 * by ensuring values stay within expected filesystem boundaries.
 */
import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

import { validateWorktreeBase, validateTestDbPath } from '../paths'

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
    expect(() => validateWorktreeBase('/etc/malicious')).toThrow(
      /home directory/i
    )
  })

  it('rejects /tmp — not in home directory', () => {
    expect(() => validateWorktreeBase('/tmp/bad')).toThrow(
      /home directory/i
    )
  })

  it('rejects /var/root path traversal attempt', () => {
    expect(() => validateWorktreeBase('/var/root/worktrees')).toThrow(
      /home directory/i
    )
  })

  it('rejects a path that starts with homedir string but escapes via traversal', () => {
    // e.g. homedir() is /Users/ryan, this tries /Users/ryanevil
    const tricky = homedir() + 'evil/worktrees'
    // Only valid if it starts with homedir() + '/'
    expect(() => validateWorktreeBase(tricky)).toThrow(
      /home directory/i
    )
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

  it.skipIf(process.platform !== 'darwin')('accepts a path in /private/tmp (macOS real tmpdir)', () => {
    expect(() => validateTestDbPath('/private/tmp/test.db')).not.toThrow()
  })

  it('accepts undefined (BDE_TEST_DB not set)', () => {
    expect(() => validateTestDbPath(undefined)).not.toThrow()
  })

  it('rejects /etc/passwd', () => {
    expect(() => validateTestDbPath('/etc/passwd')).toThrow(
      /tmp/i
    )
  })

  it('rejects a home directory path', () => {
    expect(() => validateTestDbPath(join(homedir(), 'sneaky.db'))).toThrow(
      /tmp/i
    )
  })

  it('rejects a root-level path', () => {
    expect(() => validateTestDbPath('/bde.db')).toThrow(
      /tmp/i
    )
  })
})
