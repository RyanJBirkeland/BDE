import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'

const {
  mockExecFile,
  mockMkdir,
  mockWriteFile,
  mockUnlink,
  mockAccess,
} = vi.hoisted(() => {
  const customSym = Symbol.for('nodejs.util.promisify.custom')
  const fn = vi.fn()
  // Attach custom promisify so that promisify(execFile) returns { stdout, stderr }
  // just like the real child_process.execFile does.
  ;(fn as unknown as Record<string | symbol, unknown>)[customSym] = (...args: unknown[]) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      fn(...args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  }
  return {
    mockExecFile: fn,
    mockMkdir: vi.fn(),
    mockWriteFile: vi.fn(),
    mockUnlink: vi.fn(),
    mockAccess: vi.fn(),
  }
})

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}))

vi.mock('fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
  access: mockAccess,
}))

import {
  createWorktree,
  removeWorktree,
  getActualBranch,
  acquireRepoLock,
  releaseRepoLock,
} from './worktree-ops'

/**
 * Helper: make mockExecFile succeed with given stdout via callback.
 * The implementation uses promisify(execFile), and our mock has
 * [promisify.custom] that wraps the callback form into { stdout, stderr }.
 */
function execFileSucceeds(stdout = ''): void {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void
    if (typeof cb === 'function') {
      cb(null, stdout, '')
    }
  })
}

function execFileSucceedsSequence(results: { stdout?: string; err?: Error }[]): void {
  let callIndex = 0
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void
    const result = results[callIndex] ?? { stdout: '' }
    callIndex++
    if (typeof cb === 'function') {
      if (result.err) {
        cb(result.err, '', '')
      } else {
        cb(null, result.stdout ?? '', '')
      }
    }
  })
}

describe('WorktreeOps', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createWorktree', () => {
    it('calls git worktree add with correct args and returns correct path/branch', async () => {
      execFileSucceedsSequence([
        { stdout: '' }, // git fetch origin
        { stdout: 'origin/main\n' }, // git symbolic-ref
        { stdout: '' }, // git worktree add
      ])

      const result = await createWorktree('/repo', 'task-42', '/tmp/worktrees')

      expect(result).toEqual({
        worktreePath: '/tmp/worktrees/task-42',
        branch: 'agent/task-42',
      })

      // Verify git fetch was called
      const fetchCall = mockExecFile.mock.calls[0]
      expect(fetchCall[0]).toBe('git')
      expect(fetchCall[1]).toEqual(['fetch', 'origin'])

      // Verify git symbolic-ref was called
      const symrefCall = mockExecFile.mock.calls[1]
      expect(symrefCall[0]).toBe('git')
      expect(symrefCall[1]).toEqual([
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        '--short',
      ])

      // Verify git worktree add was called with the trimmed symbolic-ref output
      const worktreeCall = mockExecFile.mock.calls[2]
      expect(worktreeCall[0]).toBe('git')
      expect(worktreeCall[1]).toEqual([
        'worktree',
        'add',
        '-b',
        'agent/task-42',
        '/tmp/worktrees/task-42',
        'origin/main',
      ])
    })

    it('uses provided baseBranch instead of detecting default', async () => {
      execFileSucceedsSequence([
        { stdout: '' }, // git fetch origin
        { stdout: '' }, // git worktree add
      ])

      const result = await createWorktree('/repo', 'task-99', '/tmp/wt', 'develop')

      expect(result).toEqual({
        worktreePath: '/tmp/wt/task-99',
        branch: 'agent/task-99',
      })

      // Should skip symbolic-ref and go straight to worktree add
      expect(mockExecFile).toHaveBeenCalledTimes(2)
      const worktreeCall = mockExecFile.mock.calls[1]
      expect(worktreeCall[1]).toEqual([
        'worktree',
        'add',
        '-b',
        'agent/task-99',
        '/tmp/wt/task-99',
        'develop',
      ])
    })

    it('falls back to main when symbolic-ref fails', async () => {
      execFileSucceedsSequence([
        { stdout: '' }, // git fetch origin
        { err: new Error('not a symbolic ref') }, // git symbolic-ref fails
        { stdout: '' }, // git worktree add
      ])

      const result = await createWorktree('/repo', 'task-1', '/tmp/wt')

      expect(result.branch).toBe('agent/task-1')

      // Worktree add should use 'main' as fallback
      const worktreeCall = mockExecFile.mock.calls[2]
      expect(worktreeCall[1]).toContain('main')
    })

    it('continues when git fetch fails (offline mode)', async () => {
      execFileSucceedsSequence([
        { err: new Error('Could not resolve host') }, // git fetch fails
        { stdout: 'origin/main\n' }, // git symbolic-ref
        { stdout: '' }, // git worktree add
      ])

      const result = await createWorktree('/repo', 'task-offline', '/tmp/wt')

      expect(result).toEqual({
        worktreePath: '/tmp/wt/task-offline',
        branch: 'agent/task-offline',
      })
    })

    it('creates the worktreeBase directory', async () => {
      execFileSucceeds()

      await createWorktree('/repo', 'task-mkdir', '/tmp/wt')

      expect(mockMkdir).toHaveBeenCalledWith('/tmp/wt', { recursive: true })
    })
  })

  describe('removeWorktree', () => {
    it('calls git worktree remove --force then git worktree prune', async () => {
      execFileSucceeds()

      await removeWorktree('/repo', '/tmp/wt/task-42')

      expect(mockExecFile).toHaveBeenCalledTimes(2)

      // First call: git worktree remove --force
      const removeCall = mockExecFile.mock.calls[0]
      expect(removeCall[0]).toBe('git')
      expect(removeCall[1]).toEqual([
        'worktree',
        'remove',
        '--force',
        '/tmp/wt/task-42',
      ])

      // Second call: git worktree prune
      const pruneCall = mockExecFile.mock.calls[1]
      expect(pruneCall[0]).toBe('git')
      expect(pruneCall[1]).toEqual(['worktree', 'prune'])
    })
  })

  describe('getActualBranch', () => {
    it('returns the current branch of the worktree', async () => {
      execFileSucceeds('agent/task-42\n')

      const branch = await getActualBranch('/tmp/wt/task-42')

      expect(branch).toBe('agent/task-42')

      const call = mockExecFile.mock.calls[0]
      expect(call[0]).toBe('git')
      expect(call[1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD'])
    })
  })

  describe('acquireRepoLock', () => {
    it('writes a lock file with PID', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      const hash = createHash('md5').update('/repo').digest('hex').slice(0, 8)
      const expectedLockPath = `/tmp/wt/.lock-${hash}`

      await acquireRepoLock('/repo', '/tmp/wt')

      expect(mockAccess).toHaveBeenCalledWith(expectedLockPath)
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedLockPath,
        String(process.pid),
      )
    })

    it('spins when lock file exists then acquires when released', async () => {
      vi.useFakeTimers()

      // First call: lock exists; second call: lock gone
      mockAccess
        .mockResolvedValueOnce(undefined) // lock exists
        .mockRejectedValueOnce(new Error('ENOENT')) // lock gone

      const hash = createHash('md5').update('/repo').digest('hex').slice(0, 8)
      const expectedLockPath = `/tmp/wt/.lock-${hash}`

      const promise = acquireRepoLock('/repo', '/tmp/wt')

      // Advance past the spin-wait interval
      await vi.advanceTimersByTimeAsync(500)

      await promise

      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedLockPath,
        String(process.pid),
      )

      vi.useRealTimers()
    })

    it('throws after 30s timeout', async () => {
      vi.useFakeTimers()

      // Lock always exists
      mockAccess.mockResolvedValue(undefined)

      const promise = acquireRepoLock('/repo', '/tmp/wt')

      // Attach the rejection handler before advancing time
      // so Node doesn't flag it as unhandled
      const rejectPromise = expect(promise).rejects.toThrow(/timeout/i)

      // Advance past 30s timeout in one shot
      await vi.advanceTimersByTimeAsync(31_000)

      await rejectPromise

      vi.useRealTimers()
    })
  })

  describe('releaseRepoLock', () => {
    it('deletes the lock file', async () => {
      const hash = createHash('md5').update('/repo').digest('hex').slice(0, 8)
      const expectedLockPath = `/tmp/wt/.lock-${hash}`

      await releaseRepoLock('/repo', '/tmp/wt')

      expect(mockUnlink).toHaveBeenCalledWith(expectedLockPath)
    })
  })
})
