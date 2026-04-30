import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getReviewDiff, getReviewCommits, getReviewFileDiff } from '../review-query-service'

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

vi.mock('../../lib/review-paths', () => ({
  validateGitRef: vi.fn(),
  validateWorktreePath: vi.fn(),
  validateFilePath: vi.fn(),
  assertWorktreeExists: vi.fn()
}))

vi.mock('../review-merge-service', () => ({
  parseNumstat: vi.fn()
}))

import { execFileAsync } from '../../lib/async-utils'
import { parseNumstat } from '../review-merge-service'

const ENV = { PATH: '/usr/bin' }
const DEPS = { env: ENV }
const WORKTREE = '/tmp/agent-worktree'
const BASE = 'origin/main'

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getReviewDiff
// ---------------------------------------------------------------------------

describe('getReviewDiff', () => {
  it('returns empty files array when numstat output is blank', async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: '   ', stderr: '' }) // numstat
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // full diff

    const result = await getReviewDiff(WORKTREE, BASE, DEPS)

    expect(result.files).toHaveLength(0)
    expect(parseNumstat).not.toHaveBeenCalled()
  })

  it('passes numstat output and patch map to parseNumstat', async () => {
    const numstatOut = '10\t2\tsrc/foo.ts\n'
    const patchOut = 'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n'
    const fakeParsed = [{ path: 'src/foo.ts', status: 'M', additions: 10, deletions: 2, patch: patchOut }]

    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: numstatOut, stderr: '' })
      .mockResolvedValueOnce({ stdout: patchOut, stderr: '' })

    vi.mocked(parseNumstat).mockReturnValue(fakeParsed as any)

    const result = await getReviewDiff(WORKTREE, BASE, DEPS)

    expect(parseNumstat).toHaveBeenCalledWith(numstatOut, expect.any(Map))
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.path).toBe('src/foo.ts')
  })
})

// ---------------------------------------------------------------------------
// getReviewCommits
// ---------------------------------------------------------------------------

describe('getReviewCommits', () => {
  it('returns empty array when git log produces no output', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '\n', stderr: '' })

    const result = await getReviewCommits(WORKTREE, BASE, DEPS)

    expect(result.commits).toHaveLength(0)
  })

  it('parses null-delimited commit log into structured commits', async () => {
    const sha = 'abc123'
    const msg = 'feat(foo): add bar'
    const author = 'Dev'
    const date = '2026-04-01T12:00:00Z'
    const logLine = [sha, msg, author, date].join('\x00')

    vi.mocked(execFileAsync).mockResolvedValue({ stdout: logLine + '\n', stderr: '' })

    const result = await getReviewCommits(WORKTREE, BASE, DEPS)

    expect(result.commits).toHaveLength(1)
    expect(result.commits[0]).toMatchObject({ hash: sha, message: msg, author, date })
  })

  it('parses multiple commits from multi-line log output', async () => {
    const line1 = ['sha1', 'first commit', 'Alice', '2026-04-01T00:00:00Z'].join('\x00')
    const line2 = ['sha2', 'second commit', 'Bob', '2026-04-02T00:00:00Z'].join('\x00')

    vi.mocked(execFileAsync).mockResolvedValue({ stdout: line1 + '\n' + line2 + '\n', stderr: '' })

    const result = await getReviewCommits(WORKTREE, BASE, DEPS)

    expect(result.commits).toHaveLength(2)
    expect(result.commits[0]?.hash).toBe('sha1')
    expect(result.commits[1]?.hash).toBe('sha2')
  })
})

// ---------------------------------------------------------------------------
// getReviewFileDiff
// ---------------------------------------------------------------------------

describe('getReviewFileDiff', () => {
  it('returns the diff string for the requested file', async () => {
    const patch = 'diff --git a/x.ts b/x.ts\n+added line\n'
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: patch, stderr: '' })

    const result = await getReviewFileDiff(WORKTREE, 'x.ts', BASE, DEPS)

    expect(result.diff).toBe(patch)
  })

  it('calls git diff with the correct arguments', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    await getReviewFileDiff(WORKTREE, 'src/bar.ts', BASE, DEPS)

    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['diff', `${BASE}...HEAD`, '--', 'src/bar.ts'],
      expect.objectContaining({ cwd: WORKTREE })
    )
  })
})
