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

  describe('Repositories path pattern', () => {
    it('extracts the repo name from a standard Repositories path', () => {
      expect(cwdToRepoLabel('/Users/ryan/Documents/Repositories/BDE')).toBe('BDE')
    })

    it('extracts the repo name from a deeper Repositories path', () => {
      expect(cwdToRepoLabel('/Users/ryan/Documents/Repositories/life-os/src/lib')).toBe('life-os')
    })
  })

  describe('worktrees path pattern', () => {
    it('returns the path segment(s) after "worktrees"', () => {
      expect(cwdToRepoLabel('/Users/ryan/.bde/worktrees/feat/my-feature')).toBe('feat/my-feature')
    })

    it('returns single segment after "worktrees"', () => {
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
