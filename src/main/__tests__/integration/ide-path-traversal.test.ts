import { describe, it, expect } from 'vitest'
import { validateIdePath } from '../../handlers/ide-fs-handlers'

const WATCHED_ROOT = '/home/user/project'

describe('IDE path traversal prevention', () => {
  it('rejects ../../etc/passwd traversal', () => {
    expect(() => validateIdePath(`${WATCHED_ROOT}/../../etc/passwd`, WATCHED_ROOT)).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects relative traversal in subdirectory', () => {
    expect(() => validateIdePath(`${WATCHED_ROOT}/src/../../etc/shadow`, WATCHED_ROOT)).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects absolute paths outside watched root', () => {
    expect(() => validateIdePath('/etc/passwd', WATCHED_ROOT)).toThrow('Path traversal blocked')
  })

  it('rejects paths that share a prefix but are outside root', () => {
    // /home/user/project-evil should NOT pass validation for root /home/user/project
    expect(() => validateIdePath('/home/user/project-evil/file.txt', WATCHED_ROOT)).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects null bytes in path', () => {
    const malicious = `${WATCHED_ROOT}/file\x00../../etc/passwd`
    // Node's path.resolve truncates at null byte on some platforms.
    // The resolved path either stays inside root (harmless) or goes outside (blocked).
    try {
      const result = validateIdePath(malicious, WATCHED_ROOT)
      // If it didn't throw, the resolved path must still be inside the root
      expect(result.startsWith(WATCHED_ROOT + '/')).toBe(true)
    } catch (err) {
      expect((err as Error).message).toContain('Path traversal blocked')
    }
  })

  it('allows valid paths within watched root', () => {
    const result = validateIdePath(`${WATCHED_ROOT}/src/index.ts`, WATCHED_ROOT)
    expect(result).toBe(`${WATCHED_ROOT}/src/index.ts`)
  })

  it('allows the root path itself', () => {
    const result = validateIdePath(WATCHED_ROOT, WATCHED_ROOT)
    expect(result).toBe(WATCHED_ROOT)
  })

  it('allows nested subdirectory paths', () => {
    const result = validateIdePath(`${WATCHED_ROOT}/a/b/c/d.txt`, WATCHED_ROOT)
    expect(result).toBe(`${WATCHED_ROOT}/a/b/c/d.txt`)
  })
})
