import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPullRequest } from '../review-pr-service'

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

vi.mock('../../lib/git-operations', () => ({
  pushBranch: vi.fn(),
  checkExistingPr: vi.fn()
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}))

import { execFileAsync } from '../../lib/async-utils'
import { pushBranch, checkExistingPr } from '../../lib/git-operations'

const OPTIONS = {
  worktreePath: '/tmp/worktree',
  branch: 'agent/t-123-fix-bug',
  title: 'Fix: correct the thing',
  body: 'Full description here.',
  env: { PATH: '/usr/bin' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPullRequest — push success, new PR', () => {
  it('creates a PR and returns the URL and number on success', async () => {
    vi.mocked(pushBranch).mockResolvedValue({ success: true })
    vi.mocked(checkExistingPr).mockResolvedValue(null)
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: 'https://github.com/owner/repo/pull/42\n',
      stderr: ''
    })

    const result = await createPullRequest(OPTIONS)

    expect(result.success).toBe(true)
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42')
    expect(result.prNumber).toBe(42)
    expect(result.error).toBeUndefined()
  })
})

describe('createPullRequest — existing PR returned', () => {
  it('returns the existing PR without calling gh pr create', async () => {
    vi.mocked(pushBranch).mockResolvedValue({ success: true })
    vi.mocked(checkExistingPr).mockResolvedValue({
      prUrl: 'https://github.com/owner/repo/pull/7',
      prNumber: 7
    })

    const result = await createPullRequest(OPTIONS)

    expect(result.success).toBe(true)
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/7')
    expect(result.prNumber).toBe(7)
    // gh pr create should not have been called
    expect(execFileAsync).not.toHaveBeenCalled()
  })
})

describe('createPullRequest — push auth failure', () => {
  it('returns success=false with error message when push fails due to auth', async () => {
    vi.mocked(pushBranch).mockResolvedValue({
      success: false,
      error: 'Authentication failed (403)'
    })

    const result = await createPullRequest(OPTIONS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Auth')
    // checkExistingPr and gh pr create should not have been called
    expect(checkExistingPr).not.toHaveBeenCalled()
    expect(execFileAsync).not.toHaveBeenCalled()
  })
})

describe('createPullRequest — push network error', () => {
  it('returns success=false with generic push error', async () => {
    vi.mocked(pushBranch).mockResolvedValue({
      success: false,
      error: 'ETIMEDOUT: network unreachable'
    })

    const result = await createPullRequest(OPTIONS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('ETIMEDOUT')
    expect(result.prUrl).toBeUndefined()
  })
})

describe('createPullRequest — branch already exists (gh CLI error)', () => {
  it('catches gh CLI failure and surfaces the error message', async () => {
    vi.mocked(pushBranch).mockResolvedValue({ success: true })
    vi.mocked(checkExistingPr).mockResolvedValue(null)
    vi.mocked(execFileAsync).mockRejectedValue(
      new Error("GraphQL: A pull request already exists for agent/t-123-fix-bug.")
    )

    const result = await createPullRequest(OPTIONS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
    expect(result.prUrl).toBeUndefined()
  })
})
