import { describe, it, expect } from 'vitest'
import { cwdToRepoLabel } from '../utils'

describe('cwdToRepoLabel', () => {
  describe('null / falsy input', () => {
    it('returns "unknown" for null', () => {
      expect(cwdToRepoLabel(null)).toBe('unknown')
    })

    it('returns "unknown" for empty string', () => {
      expect(cwdToRepoLabel('')).toBe('unknown')
    })
  })

  describe('Unix paths', () => {
    it('returns the last path segment for a projects-style path', () => {
      expect(cwdToRepoLabel('/Users/alice/projects/BDE')).toBe('BDE')
    })

    it('returns the last path segment for a src-style path', () => {
      expect(cwdToRepoLabel('/home/alice/src/my-app')).toBe('my-app')
    })

    it('returns the last path segment from a deep path', () => {
      expect(cwdToRepoLabel('/Users/ryan/projects/life-os/src/lib')).toBe('lib')
    })
  })

  describe('Windows paths', () => {
    it('returns the last path segment for a Windows path', () => {
      expect(cwdToRepoLabel('C:\\Users\\alice\\projects\\BDE')).toBe('BDE')
    })
  })

  describe('worktrees paths', () => {
    it('returns the last segment of a worktree path', () => {
      expect(cwdToRepoLabel('/Users/ryan/worktrees/BDE/feat/my-feature')).toBe('my-feature')
    })

    it('returns single segment after worktrees root', () => {
      expect(cwdToRepoLabel('/tmp/worktrees/my-branch')).toBe('my-branch')
    })
  })

  describe('fallback — last path segment', () => {
    it('returns the last path segment for an unrecognised path', () => {
      expect(cwdToRepoLabel('/home/user/projects/myrepo')).toBe('myrepo')
    })

    it('handles a single-segment path', () => {
      expect(cwdToRepoLabel('myrepo')).toBe('myrepo')
    })
  })
})
