import { describe, it, expect } from 'vitest'
import { branchNameForTask } from '../agent-manager/worktree'

describe('branchNameForTask', () => {
  it('generates agent/ prefixed branch name', () => {
    const name = branchNameForTask('Build the login page', 'abc12345')
    expect(name.startsWith('agent/')).toBe(true)
  })

  it('slugifies the title to lowercase alphanumeric with hyphens', () => {
    const name = branchNameForTask('Fix: the BROKEN thing!', 'abc12345')
    expect(name).toMatch(/^agent\/[a-z0-9-]+-[a-z0-9]+$/)
    expect(name).not.toContain(' ')
    expect(name).not.toContain('!')
    expect(name).not.toContain(':')
  })

  it('includes first 8 chars of task ID as suffix', () => {
    const name = branchNameForTask('My task', 'deadbeef12345678')
    expect(name).toContain('-deadbeef')
    // Only first 8 chars
    expect(name).not.toContain('deadbeef1')
  })

  it('works without taskId', () => {
    const name = branchNameForTask('My task')
    expect(name).toBe('agent/my-task')
  })

  it('truncates long titles to BRANCH_SLUG_MAX_LENGTH (40)', () => {
    const longTitle = 'a-very-long-title-that-exceeds-the-maximum-slug-length-allowed-by-the-system'
    const name = branchNameForTask(longTitle, 'abc12345')
    // Slug max is 40 chars, then -abc12345 (9 chars), then agent/ prefix (6 chars)
    // Total should be at most 6 + 40 + 9 = 55
    const slug = name.replace('agent/', '').replace(/-[a-f0-9]{8}$/, '')
    expect(slug.length).toBeLessThanOrEqual(40)
  })

  it('handles special characters in title', () => {
    const name = branchNameForTask('feat(scope): add [brackets] & stuff', 'abc12345')
    expect(name).toMatch(/^agent\/[a-z0-9-]+-[a-z0-9]+$/)
  })

  it('handles empty title with fallback to unnamed-task', () => {
    const name = branchNameForTask('', 'abc12345')
    expect(name).toBe('agent/unnamed-task-abc12345')
  })

  it('handles all-special-character title with fallback', () => {
    const name = branchNameForTask('!!!@@@###', 'abc12345')
    expect(name).toBe('agent/unnamed-task-abc12345')
  })

  it('strips leading and trailing hyphens from slug', () => {
    const name = branchNameForTask('--hello--', 'abc12345')
    expect(name).toBe('agent/hello-abc12345')
  })

  it('collapses multiple consecutive special chars into single hyphen', () => {
    const name = branchNameForTask('hello   world!!!test', 'abc12345')
    expect(name).toBe('agent/hello-world-test-abc12345')
  })

  it('produces consistent output for same input', () => {
    const name1 = branchNameForTask('Test Task', 'abc12345')
    const name2 = branchNameForTask('Test Task', 'abc12345')
    expect(name1).toBe(name2)
  })
})
