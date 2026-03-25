import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync, rmSync } from 'node:fs'

// Mock node:child_process before importing module under test
vi.mock('node:child_process', () => {
  const execFile = vi.fn()
  return { execFile }
})

import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { branchNameForTask, setupWorktree, cleanupWorktree, pruneStaleWorktrees } from '../worktree'

const execFileMock = vi.mocked(execFile)

// Helper to make execFile resolve successfully
function mockExecFileSuccess() {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1]
    if (typeof cb === 'function') {
      cb(null, '', '')
    }
    const p = Promise.resolve({ stdout: '', stderr: '' })
    return Object.assign(p, { child: null }) as unknown as ChildProcess
  })
}

describe('branchNameForTask', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(branchNameForTask('My Task Title')).toBe('agent/my-task-title')
  })

  it('collapses multiple non-alphanumeric characters into a single hyphen', () => {
    expect(branchNameForTask('Fix bug!! in parser')).toBe('agent/fix-bug-in-parser')
  })

  it('trims leading and trailing hyphens', () => {
    expect(branchNameForTask('  --task--  ')).toBe('agent/task')
  })

  it('handles special characters', () => {
    expect(branchNameForTask('feat: add @user support (v2)')).toBe('agent/feat-add-user-support-v2')
  })

  it('truncates slug to 40 characters', () => {
    const longTitle = 'a'.repeat(100)
    const result = branchNameForTask(longTitle)
    // "agent/" prefix is not part of the 40-char slug
    const slug = result.replace('agent/', '')
    expect(slug.length).toBeLessThanOrEqual(40)
  })

  it('handles titles with only special characters', () => {
    const result = branchNameForTask('!!!---###')
    expect(result).toBe('agent/')
  })

  it('produces correct format for normal title', () => {
    expect(branchNameForTask('Add login page')).toBe('agent/add-login-page')
  })

  it('generates agent branch from title', () => {
    expect(branchNameForTask('Fix auth bugs')).toBe('agent/fix-auth-bugs')
  })

  it('includes task ID suffix when provided', () => {
    const branch = branchNameForTask('Fix auth bugs', 'abc12345-def6-7890')
    expect(branch).toBe('agent/fix-auth-bugs-abc12345')
  })

  it('generates different branches for same title with different IDs', () => {
    const b1 = branchNameForTask('Fix auth bugs', 'id-111111')
    const b2 = branchNameForTask('Fix auth bugs', 'id-222222')
    expect(b1).not.toBe(b2)
  })

  it('truncates title slug to 40 chars', () => {
    const longTitle = 'This is a very long title that exceeds the forty character limit for slugs'
    const branch = branchNameForTask(longTitle, 'abc12345')
    expect(branch.length).toBeLessThanOrEqual(60) // agent/ + 40 + - + 8
  })
})

describe('setupWorktree', () => {
  let tmpDir: string
  let mockRepoPath: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bde-worktree-test-${Date.now()}`)
    mockRepoPath = path.join(tmpDir, 'mock-repo')
    mkdirSync(tmpDir, { recursive: true })
    // Create a mock git repository structure
    mkdirSync(path.join(mockRepoPath, '.git'), { recursive: true })
    execFileMock.mockReset()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('calls git worktree add with correct arguments', async () => {
    mockExecFileSuccess()

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-123',
      title: 'Add login page',
    })

    // Find the call to `git worktree add`
    const addCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'add'
    )
    expect(addCall).toBeDefined()
    const args = addCall![1] as string[]
    expect(args[2]).toBe('-b')
    expect(args[3]).toBe('agent/add-login-page-task-123')
    expect(args[4]).toContain('task-123')
    expect(result.branch).toBe('agent/add-login-page-task-123')
    expect(result.worktreePath).toContain('task-123')
  })

  it('uses repoPath as cwd for git commands', async () => {
    mockExecFileSuccess()

    await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-456',
      title: 'Fix bug',
    })

    const addCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][1] === 'add'
    )
    expect(addCall).toBeDefined()
    const opts = addCall![2] as { cwd: string }
    expect(opts.cwd).toBe(mockRepoPath)
  })

  it('throws error when repoPath does not exist', async () => {
    mockExecFileSuccess()

    await expect(
      setupWorktree({
        repoPath: '/nonexistent/repo',
        worktreeBase: tmpDir,
        taskId: 'task-123',
        title: 'Test task',
      })
    ).rejects.toThrow('Repo path does not exist or is not a git repository: /nonexistent/repo')
  })

  it('throws error when repoPath is not a git repository', async () => {
    mockExecFileSuccess()
    const nonGitDir = path.join(tmpDir, 'not-a-repo')
    mkdirSync(nonGitDir, { recursive: true })

    await expect(
      setupWorktree({
        repoPath: nonGitDir,
        worktreeBase: tmpDir,
        taskId: 'task-456',
        title: 'Test task',
      })
    ).rejects.toThrow(`Repo path does not exist or is not a git repository: ${nonGitDir}`)
  })

  it('retries on stale branch by deleting and re-creating', async () => {
    let callCount = 0
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1]
      callCount++
      // First call (worktree add) fails with "already exists"
      // Subsequent calls (prune, branch -D, retry add) succeed
      const err = callCount === 1 ? new Error('branch already exists') : null
      if (typeof cb === 'function') {
        cb(err, '', '')
      }
      const p = callCount === 1 ? Promise.reject(new Error('branch already exists')) : Promise.resolve({ stdout: '', stderr: '' })
      return Object.assign(p, { child: null }) as unknown as ChildProcess
    })

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-789',
      title: 'Bad task',
    })

    // Should succeed after retry
    expect(result.branch).toBe('agent/bad-task-task-789')

    // Verify branch delete was called during retry
    const branchDeleteCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('-D')
    )
    expect(branchDeleteCall).toBeDefined()
  })
})

describe('cleanupWorktree', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    mockExecFileSuccess()
  })

  it('calls git worktree remove with --force', () => {
    cleanupWorktree({
      repoPath: '/repos/proj',
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'agent/my-task',
    })

    const removeCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'remove'
    )
    expect(removeCall).toBeDefined()
    const args = removeCall![1] as string[]
    expect(args).toContain('/tmp/worktrees/task-1')
    expect(args).toContain('--force')
  })

  it('calls git branch -D to delete the branch', () => {
    cleanupWorktree({
      repoPath: '/repos/proj',
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'agent/my-task',
    })

    const branchCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'branch'
    )
    expect(branchCall).toBeDefined()
    const args = branchCall![1] as string[]
    expect(args).toContain('-D')
    expect(args).toContain('agent/my-task')
  })

  it('uses repoPath as cwd', () => {
    cleanupWorktree({
      repoPath: '/repos/proj',
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'agent/my-task',
    })

    for (const call of execFileMock.mock.calls) {
      const opts = call[2] as { cwd?: string }
      if (opts && opts.cwd) {
        expect(opts.cwd).toBe('/repos/proj')
      }
    }
  })
})

describe('pruneStaleWorktrees', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bde-prune-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeWorktreeDir(repoSlug: string, taskId: string): string {
    const dir = path.join(tmpDir, repoSlug, taskId)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  it('returns 0 when worktreeBase does not exist', async () => {
    const count = await pruneStaleWorktrees('/nonexistent/path', () => false)
    expect(count).toBe(0)
  })

  it('removes directories for inactive tasks and returns count', async () => {
    makeWorktreeDir('repo-a', 'task-inactive-1')
    makeWorktreeDir('repo-a', 'task-inactive-2')

    const count = await pruneStaleWorktrees(tmpDir, () => false)
    expect(count).toBe(2)
  })

  it('keeps directories for active tasks', async () => {
    const activeDir = makeWorktreeDir('repo-b', 'task-active-1')
    makeWorktreeDir('repo-b', 'task-inactive-1')

    const { existsSync } = await import('node:fs')
    const count = await pruneStaleWorktrees(tmpDir, (id) => id === 'task-active-1')
    expect(count).toBe(1)
    expect(existsSync(activeDir)).toBe(true)
  })

  it('does not count .locks directory as a repo dir', async () => {
    const locksDir = path.join(tmpDir, '.locks')
    mkdirSync(locksDir, { recursive: true })

    const count = await pruneStaleWorktrees(tmpDir, () => false)
    expect(count).toBe(0)
  })

  it('returns 0 when all tasks are active', async () => {
    makeWorktreeDir('repo-c', 'task-1')
    makeWorktreeDir('repo-c', 'task-2')

    const count = await pruneStaleWorktrees(tmpDir, () => true)
    expect(count).toBe(0)
  })
})
