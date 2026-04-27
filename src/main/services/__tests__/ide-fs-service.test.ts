import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mkdtemp, writeFile, symlink, rm } from 'fs/promises'
import { validateIdePath, _resetApprovedIdeRoots } from '../ide-fs-service'

// electron and paths modules are not available in the test environment
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../paths', () => ({ getConfiguredRepos: () => [] }))

describe('validateIdePath', () => {
  let tmpDir: string

  beforeEach(async () => {
    _resetApprovedIdeRoots()
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ide-fs-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('accepts a path within the root', () => {
    const filePath = path.join(tmpDir, 'src', 'index.ts')
    // The file need not exist; validateIdePath resolves parent-level symlinks
    const result = validateIdePath(filePath, tmpDir)
    expect(result.startsWith(fs.realpathSync(tmpDir))).toBe(true)
    expect(result).toContain('src/index.ts')
  })

  it('accepts the root itself', () => {
    const result = validateIdePath(tmpDir, tmpDir)
    expect(result).toBe(fs.realpathSync(tmpDir))
  })

  it('blocks path traversal via ../', () => {
    const escapingPath = path.join(tmpDir, '..', 'etc', 'passwd')
    expect(() => validateIdePath(escapingPath, tmpDir)).toThrow('Path traversal blocked')
  })

  it('blocks a sibling directory that shares a prefix', () => {
    // e.g. root is /tmp/abc, attacker supplies /tmp/abcevil/secret
    const siblingPath = tmpDir + 'evil/secret'
    expect(() => validateIdePath(siblingPath, tmpDir)).toThrow('Path traversal blocked')
  })

  it('resolves a symlink that stays within the root', async () => {
    const realFile = path.join(tmpDir, 'real.txt')
    const linkFile = path.join(tmpDir, 'link.txt')
    await writeFile(realFile, 'hello')
    await symlink(realFile, linkFile)

    const result = validateIdePath(linkFile, tmpDir)
    expect(result).toBe(fs.realpathSync(tmpDir) + '/real.txt')
  })

  it('blocks a symlink that escapes the root', async () => {
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'ide-fs-outside-'))
    try {
      const outsideFile = path.join(outsideDir, 'secret.txt')
      await writeFile(outsideFile, 'secret')
      const linkInsideRoot = path.join(tmpDir, 'escape-link.txt')
      await symlink(outsideFile, linkInsideRoot)

      expect(() => validateIdePath(linkInsideRoot, tmpDir)).toThrow('Path traversal blocked')
    } finally {
      await rm(outsideDir, { recursive: true, force: true })
    }
  })
})
