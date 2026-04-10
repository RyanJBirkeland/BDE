import { describe, it, expect } from 'vitest'
import { getIdeRootPath, validateIdePath } from '../ide-fs-handlers'
import { homedir } from 'os'
import { resolve } from 'path'

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
})
