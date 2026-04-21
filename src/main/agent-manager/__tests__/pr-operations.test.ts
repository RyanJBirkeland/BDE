/**
 * PR operations unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generatePrBody, sanitizeForGit } from '../pr-operations'

// Mock async-utils
vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn(),
  sleep: vi.fn()
}))

// Mock review-paths
vi.mock('../../lib/review-paths', () => ({
  validateGitRef: vi.fn((ref: string) => {
    const SAFE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,198}$/
    if (!ref || !SAFE_REF_PATTERN.test(ref)) {
      throw new Error(
        `Invalid git ref: "${ref}". Must match pattern [a-zA-Z0-9/_.-], max 200 chars.`
      )
    }
  })
}))

import { execFileAsync } from '../../lib/async-utils'

describe('generatePrBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject invalid branch name with leading dash', async () => {
    await expect(generatePrBody('/tmp/worktree', '--malicious', {})).rejects.toThrow(
      /Invalid git ref/
    )
  })

  it('should reject invalid branch name with shell metacharacters', async () => {
    await expect(generatePrBody('/tmp/worktree', 'branch;rm -rf /', {})).rejects.toThrow(
      /Invalid git ref/
    )
  })

  it('should reject invalid branch name with command substitution', async () => {
    await expect(generatePrBody('/tmp/worktree', 'branch$(whoami)', {})).rejects.toThrow(
      /Invalid git ref/
    )
  })

  it('should reject invalid branch name with path traversal', async () => {
    await expect(generatePrBody('/tmp/worktree', '../../../etc/passwd', {})).rejects.toThrow(
      /Invalid git ref/
    )
  })

  it('should reject invalid branch name with tilde', async () => {
    await expect(generatePrBody('/tmp/worktree', 'HEAD~2', {})).rejects.toThrow(/Invalid git ref/)
  })

  it('should reject invalid branch name with caret', async () => {
    await expect(generatePrBody('/tmp/worktree', 'HEAD^', {})).rejects.toThrow(/Invalid git ref/)
  })

  it('should reject empty branch name', async () => {
    await expect(generatePrBody('/tmp/worktree', '', {})).rejects.toThrow(/Invalid git ref/)
  })

  it('should accept valid branch name', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    const result = await generatePrBody('/tmp/worktree', 'feature/my-branch', {})

    expect(result).toContain('🤖 Automated by BDE Agent Manager')
  })

  it('should accept valid branch name with slashes and dashes', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    const result = await generatePrBody('/tmp/worktree', 'agent/fix-bug-123', {})

    expect(result).toContain('🤖 Automated by BDE Agent Manager')
  })

  it('should accept valid SHA-like branch name', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    const result = await generatePrBody('/tmp/worktree', 'abc123def456', {})

    expect(result).toContain('🤖 Automated by BDE Agent Manager')
  })
})

describe('sanitizeForGit', () => {
  it('should strip newlines to prevent git trailer injection', () => {
    const malicious = 'Normal title\n\nCo-Authored-By: attacker@evil.com'
    expect(sanitizeForGit(malicious)).toBe('Normal title  Co-Authored-By: attacker@evil.com')
  })

  it('should replace backticks with single quotes', () => {
    expect(sanitizeForGit('Fix `bug`')).toBe("Fix 'bug'")
  })

  it('should strip command substitution syntax', () => {
    expect(sanitizeForGit('Title with $(whoami)')).toBe('Title with (whoami)')
  })

  it('should strip markdown links', () => {
    expect(sanitizeForGit('Fix [bug](https://example.com)')).toBe('Fix bug')
  })

  it('should handle multiple issues in one string', () => {
    const input = 'Fix `bug`\nWith [link](url)\n$(command)'
    const expected = "Fix 'bug' With link (command)"
    expect(sanitizeForGit(input)).toBe(expected)
  })
})
