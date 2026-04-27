import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getIdeRootPath,
  validateIdePath,
  validateIdeRoot,
  rememberApprovedIdeRoot,
  _resetApprovedIdeRoots
} from '../ide-fs-handlers'
import { homedir, tmpdir } from 'os'
import { resolve } from 'path'
import { mkdirSync, rmSync } from 'fs'

describe('ide-fs-handlers', () => {
  describe('getIdeRootPath', () => {
    it('should return null initially', () => {
      expect(getIdeRootPath()).toBeNull()
    })
  })

  describe('validateIdePath', () => {
    const homeDir = homedir()
    const allowedRoot = resolve(homeDir, 'projects/test')

    it('should validate path within allowed root', () => {
      const targetPath = resolve(allowedRoot, 'src/index.ts')
      const result = validateIdePath(targetPath, allowedRoot)

      expect(result).toBeTruthy()
      expect(result.startsWith(allowedRoot)).toBe(true)
    })

    it('should reject path outside allowed root', () => {
      const targetPath = resolve(homeDir, 'other/file.ts')

      expect(() => validateIdePath(targetPath, allowedRoot)).toThrow()
    })

    it('should prevent path traversal with ../', () => {
      const targetPath = resolve(allowedRoot, '../escape.ts')

      expect(() => validateIdePath(targetPath, allowedRoot)).toThrow()
    })

    it('should allow paths that do not exist yet', () => {
      const targetPath = resolve(allowedRoot, 'new-file-that-does-not-exist-12345.ts')

      expect(() => validateIdePath(targetPath, allowedRoot)).not.toThrow()
    })

    it('should handle root path itself', () => {
      const result = validateIdePath(allowedRoot, allowedRoot)
      expect(result).toBeTruthy()
    })
  })

  describe('validateIdeRoot — approved-path confinement', () => {
    const TEST_BASE = resolve(tmpdir(), 'fleet-ide-root-test')
    const DIALOG_DIR = resolve(TEST_BASE, 'dialog-pick')
    const REPO_DIR = resolve(TEST_BASE, 'configured-repo')
    const ARBITRARY_DIR = resolve(TEST_BASE, 'arbitrary')

    beforeEach(() => {
      _resetApprovedIdeRoots()
      mkdirSync(DIALOG_DIR, { recursive: true })
      mkdirSync(REPO_DIR, { recursive: true })
      mkdirSync(ARBITRARY_DIR, { recursive: true })
      vi.resetModules()
    })

    it('rejects an arbitrary path that is neither dialog-approved nor a configured repo', async () => {
      await expect(validateIdeRoot(ARBITRARY_DIR)).rejects.toThrow(/approved|configured|dialog/i)
    })

    it('accepts a path after it is registered via the dialog approval hook', async () => {
      rememberApprovedIdeRoot(DIALOG_DIR)
      const result = await validateIdeRoot(DIALOG_DIR)
      expect(result).toBe(DIALOG_DIR)
    })

    it('accepts a configured repo localPath', async () => {
      rememberApprovedIdeRoot(REPO_DIR)
      const result = await validateIdeRoot(REPO_DIR)
      expect(result).toBe(REPO_DIR)
    })

    it('still rejects when the path exists but is not on the allowlist', async () => {
      rememberApprovedIdeRoot(DIALOG_DIR)
      await expect(validateIdeRoot(ARBITRARY_DIR)).rejects.toThrow(/approved|configured|dialog/i)
    })

    it('rejects ~/.ssh even though it is inside the home directory', async () => {
      const ssh = resolve(homedir(), '.ssh')
      await expect(validateIdeRoot(ssh)).rejects.toThrow()
    })

    // Cleanup
    it.skip('cleanup placeholder — do not remove', () => {
      rmSync(TEST_BASE, { recursive: true, force: true })
    })
  })
})
