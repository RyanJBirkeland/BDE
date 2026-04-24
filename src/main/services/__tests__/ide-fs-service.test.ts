import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, symlinkSync, rmSync, existsSync, realpathSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'
import { validateIdePath, rememberApprovedIdeRoot, _resetApprovedIdeRoots } from '../ide-fs-service'

const ROOT = '/home/user/projects/myapp'

describe('validateIdePath', () => {
  it('allows a path within root', () => {
    const result = validateIdePath(`${ROOT}/src/index.ts`, ROOT)
    expect(result).toBe(`${ROOT}/src/index.ts`)
  })

  it('allows the root itself', () => {
    const result = validateIdePath(ROOT, ROOT)
    expect(result).toBe(ROOT)
  })

  it('rejects path traversal via ../', () => {
    expect(() => validateIdePath(`${ROOT}/../../etc/passwd`, ROOT)).toThrow('Path traversal blocked')
  })

  it('rejects an absolute path outside root', () => {
    expect(() => validateIdePath('/etc/passwd', ROOT)).toThrow('Path traversal blocked')
  })

  it('rejects a sibling directory that shares a root prefix', () => {
    // /home/user/projects/myapp-evil must not be allowed under /home/user/projects/myapp
    expect(() => validateIdePath(`${ROOT}-evil/file.ts`, ROOT)).toThrow('Path traversal blocked')
  })

  it('allows a path that does not yet exist inside the root', () => {
    expect(() =>
      validateIdePath(`${ROOT}/new-file-that-does-not-exist.ts`, ROOT)
    ).not.toThrow()
  })
})

describe('validateIdePath — symlink canonicalization', () => {
  const TEST_BASE = resolve(tmpdir(), 'bde-ide-fs-service-test')
  const REAL_DIR = resolve(TEST_BASE, 'real')
  const LINK_DIR = resolve(TEST_BASE, 'link')

  beforeEach(() => {
    _resetApprovedIdeRoots()
    if (existsSync(TEST_BASE)) rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(REAL_DIR, { recursive: true })
    // Create symlink: link -> real
    symlinkSync(REAL_DIR, LINK_DIR)
  })

  it('resolves a symlinked root to the real path before checking containment', () => {
    rememberApprovedIdeRoot(REAL_DIR)
    // A path accessed through the symlink root should resolve to the real path
    const targetViaLink = resolve(LINK_DIR, 'file.ts')
    // validateIdePath uses LINK_DIR as allowedRoot — it canonicalizes both sides
    const result = validateIdePath(targetViaLink, LINK_DIR)
    // Use realpathSync to get the canonical REAL_DIR (e.g. /private/tmp on macOS)
    const canonicalRealDir = realpathSync(REAL_DIR)
    expect(result.startsWith(canonicalRealDir)).toBe(true)
  })

  it('blocks a path that resolves outside the canonical root', () => {
    const OUTSIDE = resolve(TEST_BASE, 'outside')
    mkdirSync(OUTSIDE, { recursive: true })

    rememberApprovedIdeRoot(REAL_DIR)
    // A real path outside the root must be blocked
    expect(() => validateIdePath(OUTSIDE, REAL_DIR)).toThrow('Path traversal blocked')
  })
})
