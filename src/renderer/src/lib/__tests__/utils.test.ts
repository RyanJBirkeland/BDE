import { describe, it, expect } from 'vitest'
import { cwdToRepoLabel, validateGitHubUrl } from '../utils'

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
      expect(cwdToRepoLabel('/Users/alice/projects/FLEET')).toBe('FLEET')
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
      expect(cwdToRepoLabel('C:\\Users\\alice\\projects\\FLEET')).toBe('FLEET')
    })
  })

  describe('worktrees paths', () => {
    it('returns the last segment of a worktree path', () => {
      expect(cwdToRepoLabel('/Users/ryan/worktrees/FLEET/feat/my-feature')).toBe('my-feature')
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

describe('validateGitHubUrl (T-33)', () => {
  it('returns the URL when it points at github.com over https', () => {
    const url = 'https://github.com/owner/repo/pull/42'
    expect(validateGitHubUrl(url)).toBe(url)
  })

  it('accepts the www.github.com host variant', () => {
    const url = 'https://www.github.com/owner/repo'
    expect(validateGitHubUrl(url)).toBe(url)
  })

  it('returns null for javascript: scheme', () => {
    expect(validateGitHubUrl('javascript:alert(1)')).toBeNull()
  })

  it('returns null for data: scheme', () => {
    expect(validateGitHubUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('returns null for off-host URL even when github.com appears in the path', () => {
    expect(validateGitHubUrl('https://evil.com/?url=github.com')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(validateGitHubUrl(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(validateGitHubUrl(undefined)).toBeNull()
  })

  it('returns null for plain http (must be https)', () => {
    expect(validateGitHubUrl('http://github.com/owner/repo')).toBeNull()
  })

  it('returns null for malformed URLs', () => {
    expect(validateGitHubUrl('not a url')).toBeNull()
  })

  it('returns null for github look-alike subdomains', () => {
    expect(validateGitHubUrl('https://github.com.evil.com/owner/repo')).toBeNull()
  })
})
