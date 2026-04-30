import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCheckpoint } from '../checkpoint-service'

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })),
  logError: vi.fn()
}))

import { execFileAsync } from '../../lib/async-utils'

const TASK_ID = 'task-abc'
const WORKTREE = '/tmp/agent-worktree'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createCheckpoint — happy path', () => {
  it('stages all files and creates the commit', async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git add -A
      .mockResolvedValueOnce({ stdout: 'src/foo.ts\n', stderr: '' }) // git diff --cached --name-only
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git commit

    const result = await createCheckpoint(TASK_ID, WORKTREE, 'checkpoint: step 1')

    expect(result.ok).toBe(true)
    expect(result.committed).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('uses the provided message in the git commit call', async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/x.ts\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    await createCheckpoint(TASK_ID, WORKTREE, 'my custom message')

    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'my custom message'],
      expect.anything()
    )
  })

  it('falls back to the default message when none is provided', async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/x.ts\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    await createCheckpoint(TASK_ID, WORKTREE)

    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'checkpoint: user-requested snapshot'],
      expect.anything()
    )
  })
})

describe('createCheckpoint — nothing to commit', () => {
  it('returns committed=false (not an error) when diff is empty', async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git add -A
      .mockResolvedValueOnce({ stdout: '  ', stderr: '' }) // no staged files

    const result = await createCheckpoint(TASK_ID, WORKTREE)

    expect(result.ok).toBe(true)
    expect(result.committed).toBe(false)
    expect(result.error).toBe('Nothing to commit')
  })
})

describe('createCheckpoint — git failure', () => {
  it('returns ok=false with the error message when git commit fails', async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/x.ts\n', stderr: '' })
      .mockRejectedValueOnce(new Error('author identity unknown'))

    const result = await createCheckpoint(TASK_ID, WORKTREE)

    expect(result.ok).toBe(false)
    expect(result.committed).toBe(false)
    expect(result.error).toContain('author identity')
  })

  it('returns a user-friendly message when the git index.lock is held', async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/x.ts\n', stderr: '' })
      .mockRejectedValueOnce(new Error('Unable to create .git/index.lock: File exists'))

    const result = await createCheckpoint(TASK_ID, WORKTREE)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Agent is currently writing')
  })
})
