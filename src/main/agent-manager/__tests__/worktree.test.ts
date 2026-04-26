import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'

// Mock node:child_process before importing module under test
vi.mock('node:child_process', () => {
  const execFile = vi.fn()
  return { execFile }
})

// Mock main-repo-guards so the pre/post-ffMergeMain checks don't shell out
vi.mock('../../lib/main-repo-guards', () => ({
  assertRepoCleanOrAbort: vi.fn().mockResolvedValue(undefined),
  getMainRepoPorcelainStatus: vi.fn().mockResolvedValue('')
}))

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
    expect(result).toBe('agent/unnamed-task')
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
      title: 'Add login page'
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
      title: 'Fix bug'
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
        title: 'Test task'
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
        title: 'Test task'
      })
    ).rejects.toThrow(`Repo path does not exist or is not a git repository: ${nonGitDir}`)
  })

  it('proactively cleans stale state before creating worktree (branch -D called before worktree add)', async () => {
    mockExecFileSuccess()

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-789',
      title: 'Bad task'
    })

    expect(result.branch).toBe('agent/bad-task-task-789')

    // Verify branch delete was called (cleanupStaleWorktrees runs unconditionally)
    const branchDeleteCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('-D')
    )
    expect(branchDeleteCall).toBeDefined()

    // Verify branch -D is called BEFORE worktree add
    const branchDeleteIndex = execFileMock.mock.calls.findIndex(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('-D')
    )
    const worktreeAddIndex = execFileMock.mock.calls.findIndex(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'add'
    )
    expect(branchDeleteIndex).toBeLessThan(worktreeAddIndex)
  })

  it('proactively force-removes stale worktree at different path before creating', async () => {
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    const branch = 'agent/stale-test-task-sta'

    // Porcelain worktree list output with a stale entry matching the branch
    const porcelainList = [
      `worktree /some/stale/path`,
      `branch refs/heads/${branch}`,
      '',
      `worktree ${mockRepoPath}`,
      `branch refs/heads/main`,
      ''
    ].join('\n')

    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1]
      const gitArgs = args[1] as string[]

      // worktree list returns porcelain output with stale entry
      if (gitArgs[0] === 'worktree' && gitArgs[1] === 'list') {
        if (typeof cb === 'function') cb(null, { stdout: porcelainList, stderr: '' })
        return Object.assign(Promise.resolve({ stdout: porcelainList, stderr: '' }), {
          child: null
        }) as unknown as ChildProcess
      }

      // Everything else succeeds
      if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
      return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
        child: null
      }) as unknown as ChildProcess
    })

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-stale',
      title: 'Stale test',
      logger: logger as unknown as import('../types').Logger
    })

    expect(result.branch).toBe(branch)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Removing stale worktree'))
    // Verify force-remove was called on the stale path (proactively, before worktree add)
    const forceRemoveCall = execFileMock.mock.calls.find(
      (c) =>
        c[0] === 'git' &&
        Array.isArray(c[1]) &&
        c[1][0] === 'worktree' &&
        c[1][1] === 'remove' &&
        c[1].includes('/some/stale/path')
    )
    expect(forceRemoveCall).toBeDefined()

    // Verify force-remove occurred BEFORE worktree add
    const forceRemoveIndex = execFileMock.mock.calls.findIndex(
      (c) =>
        c[0] === 'git' &&
        Array.isArray(c[1]) &&
        c[1][0] === 'worktree' &&
        c[1][1] === 'remove' &&
        c[1].includes('/some/stale/path')
    )
    const worktreeAddIndex = execFileMock.mock.calls.findIndex(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'add'
    )
    expect(forceRemoveIndex).toBeLessThan(worktreeAddIndex)
  })

  it('does not push before deleting stale branch (agent branches are throwaway)', async () => {
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    const branch = 'agent/push-test-task-pus'

    mockExecFileSuccess()

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-push',
      title: 'Push test',
      logger: logger as unknown as import('../types').Logger
    })

    expect(result.branch).toBe(branch)
    // Verify NO push was attempted (agent branches are throwaway)
    const pushCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'push'
    )
    expect(pushCall).toBeUndefined()
    // Verify NO rev-list check for unpushed commits
    const revListCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'rev-list'
    )
    expect(revListCall).toBeUndefined()
  })

  it('throws original error for non-branch-exists failures', async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1]
      const gitArgs = args[1] as string[]

      // worktree add fails with a non-"already exists" error
      if (gitArgs[0] === 'worktree' && gitArgs[1] === 'add') {
        const err = new Error('fatal: unable to create worktree')
        if (typeof cb === 'function') cb(err, '', '')
        return Object.assign(Promise.reject(err), { child: null }) as unknown as ChildProcess
      }

      // Everything else succeeds (cleanup calls)
      if (typeof cb === 'function') cb(null, '', '')
      return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
        child: null
      }) as unknown as ChildProcess
    })

    await expect(
      setupWorktree({
        repoPath: mockRepoPath,
        worktreeBase: tmpDir,
        taskId: 'task-fail',
        title: 'Fail test'
      })
    ).rejects.toThrow('fatal: unable to create worktree')

    // releaseLock fires rm() fire-and-forget (async libuv I/O) — poll until gone
    const repoSlugVal = mockRepoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const lockFile = path.join(tmpDir, '.locks', `${repoSlugVal}.lock`)
    await vi.waitFor(() => expect(existsSync(lockFile)).toBe(false), { timeout: 1000 })
  })

  it('cleans up lock and throws when worktree add fails after nuke', async () => {
    // cleanupStaleWorktrees succeeds, but worktree add itself fails
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1]
      const gitArgs = args[1] as string[]

      if (gitArgs[0] === 'worktree' && gitArgs[1] === 'add') {
        const err = new Error('fatal: unable to create worktree')
        if (typeof cb === 'function') cb(err, '', '')
        return Object.assign(Promise.reject(err), { child: null }) as unknown as ChildProcess
      }

      // Everything else (cleanupStaleWorktrees calls) succeeds
      if (typeof cb === 'function') cb(null, '', '')
      return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
        child: null
      }) as unknown as ChildProcess
    })

    await expect(
      setupWorktree({
        repoPath: mockRepoPath,
        worktreeBase: tmpDir,
        taskId: 'task-retry',
        title: 'Retry test'
      })
    ).rejects.toThrow('fatal: unable to create worktree')

    // releaseLock fires rm() fire-and-forget (async libuv I/O) — poll until gone
    const repoSlugVal = mockRepoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const lockFile = path.join(tmpDir, '.locks', `${repoSlugVal}.lock`)
    await vi.waitFor(() => expect(existsSync(lockFile)).toBe(false), { timeout: 1000 })
  })

  it('removes corrupted lock file and proceeds', async () => {
    mockExecFileSuccess()
    const repoSlug = mockRepoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const locksDir = path.join(tmpDir, '.locks')
    mkdirSync(locksDir, { recursive: true })
    writeFileSync(path.join(locksDir, `${repoSlug}.lock`), 'not-a-number', 'utf-8')

    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-lock-1',
      title: 'Lock test',
      logger: logger as unknown as import('../types').Logger
    })

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Corrupted lock file'))
    expect(result.branch).toBe('agent/lock-test-task-loc')
  })

  it('cleans up lock held by dead PID and proceeds', async () => {
    mockExecFileSuccess()
    const repoSlug = mockRepoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const locksDir = path.join(tmpDir, '.locks')
    mkdirSync(locksDir, { recursive: true })
    writeFileSync(path.join(locksDir, `${repoSlug}.lock`), '99999999', 'utf-8')

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'task-lock-2',
      title: 'Dead PID test'
    })

    expect(result.branch).toBe('agent/dead-pid-test-task-loc')
  })

  it('throws when lock is held by alive PID', async () => {
    mockExecFileSuccess()
    const repoSlug = mockRepoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const locksDir = path.join(tmpDir, '.locks')
    mkdirSync(locksDir, { recursive: true })
    writeFileSync(path.join(locksDir, `${repoSlug}.lock`), String(process.pid), 'utf-8')

    await expect(
      setupWorktree({
        repoPath: mockRepoPath,
        worktreeBase: tmpDir,
        taskId: 'task-lock-3',
        title: 'Alive PID test'
      })
    ).rejects.toThrow(`Worktree lock held by PID ${process.pid}`)
  })

  it('fetches latest main before creating worktree', async () => {
    const calls: string[][] = []
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1]
      const gitArgs = args[1] as string[]
      calls.push(gitArgs)
      if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
      return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
        child: null
      }) as unknown as ChildProcess
    })

    await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'abc',
      title: 'test'
    })

    const fetchIdx = calls.findIndex((a) => a[0] === 'fetch' && a.includes('origin'))
    const worktreeIdx = calls.findIndex((a) => a[0] === 'worktree' && a[1] === 'add')
    expect(fetchIdx).toBeGreaterThanOrEqual(0)
    expect(worktreeIdx).toBeGreaterThan(fetchIdx)
  })

  it('runs fetch BEFORE acquiring the per-repo lock (PHASE3-3.2)', async () => {
    // Verify the lock file does not exist while git fetch is running.
    // This proves fetch is outside the lock scope so other agents can
    // proceed concurrently with their own fetches.
    const lockFile = path.join(tmpDir, '.locks', `${path.basename(mockRepoPath)}.lock`)
    // Note the actual lockPath uses repoSlug — recompute the same way:
    const slug = mockRepoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const expectedLock = path.join(tmpDir, '.locks', `${slug}.lock`)
    void lockFile

    let lockExistedDuringFetch = false
    let lockExistedDuringAdd = false

    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1]
      const gitArgs = args[1] as string[]
      if (gitArgs[0] === 'fetch') {
        lockExistedDuringFetch = existsSync(expectedLock)
      }
      if (gitArgs[0] === 'worktree' && gitArgs[1] === 'add') {
        lockExistedDuringAdd = existsSync(expectedLock)
      }
      if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
      return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
        child: null
      }) as unknown as ChildProcess
    })

    await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'lock-scope',
      title: 'Lock scope'
    })

    expect(lockExistedDuringFetch).toBe(false)
    expect(lockExistedDuringAdd).toBe(true)
  })

  it('calls appendToNotes when fetchMain fails and continues setup', async () => {
    const fetchError = new Error('fatal: unable to connect to origin')
    let appendedText: string | undefined

    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1]
      const gitArgs = args[1] as string[]

      // git fetch fails
      if (gitArgs[0] === 'fetch') {
        if (typeof cb === 'function') cb(fetchError, '', '')
        return Object.assign(Promise.reject(fetchError), { child: null }) as unknown as ChildProcess
      }

      // Everything else succeeds
      if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
      return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
        child: null
      }) as unknown as ChildProcess
    })

    const result = await setupWorktree({
      repoPath: mockRepoPath,
      worktreeBase: tmpDir,
      taskId: 'fetch-fail',
      title: 'Fetch fail test',
      appendToNotes: (text) => {
        appendedText = text
      }
    })

    // Setup should complete despite the fetch failure
    expect(result.branch).toBe('agent/fetch-fail-test-fetch-fa')

    // Notes should record the failure
    expect(appendedText).toBeDefined()
    expect(appendedText).toContain('[worktree] fetchMain failed:')
    expect(appendedText).toContain('unable to connect to origin')
  })
})

describe('ensureFreeDiskSpace', () => {
  it('throws InsufficientDiskSpaceError when free space is below the threshold', async () => {
    const { ensureFreeDiskSpace, InsufficientDiskSpaceError } = await import('../disk-space')
    // Use an absurdly large threshold so any real disk fails
    const required = Number.MAX_SAFE_INTEGER
    await expect(ensureFreeDiskSpace(os.tmpdir(), required)).rejects.toBeInstanceOf(
      InsufficientDiskSpaceError
    )

    // Validate the error fields carry through
    try {
      await ensureFreeDiskSpace(os.tmpdir(), required)
      throw new Error('expected ensureFreeDiskSpace to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientDiskSpaceError)
      const ide = err as InstanceType<typeof InsufficientDiskSpaceError>
      expect(ide.path).toBe(os.tmpdir())
      expect(ide.requiredBytes).toBe(required)
      expect(ide.availableBytes).toBeGreaterThanOrEqual(0)
      expect(ide.availableBytes).toBeLessThan(required)
      expect(ide.name).toBe('InsufficientDiskSpaceError')
    }
  })

  it('succeeds when there is plenty of space', async () => {
    const { ensureFreeDiskSpace } = await import('../worktree')
    // 1 byte threshold — always satisfied on a working system
    await expect(ensureFreeDiskSpace(os.tmpdir(), 1)).resolves.toBeUndefined()
  })

  it('throws DiskSpaceProbeError and logs WARN when statfs fails on a non-existent path', async () => {
    const { ensureFreeDiskSpace, DiskSpaceProbeError } = await import('../disk-space')
    const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    await expect(ensureFreeDiskSpace('/definitely/not/a/real/path', 1, log)).rejects.toBeInstanceOf(
      DiskSpaceProbeError
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[disk-space] Probe failed at /definitely/not/a/real/path')
    )
  })
})

describe('cleanupWorktree', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    mockExecFileSuccess()
  })

  it('calls git worktree remove with --force', async () => {
    await cleanupWorktree({
      repoPath: '/repos/proj',
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'agent/my-task'
    })

    const removeCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'remove'
    )
    expect(removeCall).toBeDefined()
    const args = removeCall![1] as string[]
    expect(args).toContain('/tmp/worktrees/task-1')
    expect(args).toContain('--force')
  })

  it('calls git branch -D to delete the branch', async () => {
    await cleanupWorktree({
      repoPath: '/repos/proj',
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'agent/my-task'
    })

    const branchCall = execFileMock.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'branch'
    )
    expect(branchCall).toBeDefined()
    const args = branchCall![1] as string[]
    expect(args).toContain('-D')
    expect(args).toContain('agent/my-task')
  })

  it('uses repoPath as cwd', async () => {
    await cleanupWorktree({
      repoPath: '/repos/proj',
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'agent/my-task'
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

  // Realistic BDE task ID fixtures — 32-char lowercase hex strings
  // produced by SQLite's lower(hex(randomblob(16))). The pruner requires
  // the leaf directory name to match this format before considering it
  // for deletion.
  const TASK_ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const TASK_ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const TASK_ID_C = 'cccccccccccccccccccccccccccccccc'

  /**
   * Creates a realistic BDE worktree directory: <tmp>/<repoSlug>/<uuid>/
   * with a `.git` file inside, mimicking what `git worktree add` produces.
   * The pruner's defense-in-depth check requires the .git entry to exist.
   */
  function makeWorktreeDir(repoSlug: string, taskId: string): string {
    const dir = path.join(tmpDir, repoSlug, taskId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '.git'), 'gitdir: /fake/path\n')
    return dir
  }

  it('returns 0 when worktreeBase does not exist', async () => {
    const count = await pruneStaleWorktrees('/nonexistent/path', () => false)
    expect(count).toBe(0)
  })

  // Regression: before this fix TASK_ID_HEX_PATTERN required a dashed UUID,
  // so every real BDE worktree was rejected and pruneStaleWorktrees always
  // returned 0 — a silent no-op.
  it('prunes a real-shaped 32-char hex task ID when the task is inactive', async () => {
    const realTaskId = '00313fab513f1807706c8b7665afc329'
    makeWorktreeDir('repo-regression', realTaskId)

    const count = await pruneStaleWorktrees(tmpDir, () => false)

    expect(count).toBeGreaterThan(0)
  })

  it('does NOT prune a dashed-UUID directory name (not a BDE task ID)', async () => {
    const dashedUuid = 'aaaaaaaa-1111-4111-8111-111111111111'
    const repoDir = path.join(tmpDir, 'repo-dashed')
    const dashedDir = path.join(repoDir, dashedUuid)
    mkdirSync(dashedDir, { recursive: true })
    writeFileSync(path.join(dashedDir, '.git'), 'gitdir: /fake/path\n')

    const count = await pruneStaleWorktrees(tmpDir, () => false)

    expect(count).toBe(0)
    const { existsSync } = await import('node:fs')
    expect(existsSync(dashedDir)).toBe(true)
  })

  it('removes directories for inactive tasks and returns count', async () => {
    makeWorktreeDir('repo-a', TASK_ID_A)
    makeWorktreeDir('repo-a', TASK_ID_B)

    const count = await pruneStaleWorktrees(tmpDir, () => false)
    expect(count).toBe(2)
  })

  it('keeps directories for active tasks', async () => {
    const activeDir = makeWorktreeDir('repo-b', TASK_ID_A)
    makeWorktreeDir('repo-b', TASK_ID_B)

    const { existsSync } = await import('node:fs')
    const count = await pruneStaleWorktrees(tmpDir, (id) => id === TASK_ID_A)
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
    makeWorktreeDir('repo-c', TASK_ID_A)
    makeWorktreeDir('repo-c', TASK_ID_B)

    const count = await pruneStaleWorktrees(tmpDir, () => true)
    expect(count).toBe(0)
  })

  // Regression: the prune base (~/worktrees/bde/) is shared with human
  // git worktrees per the documented ~/worktrees/<project>/<branch>
  // convention. Without UUID + .git guards the pruner deletes src/,
  // docs/, etc. inside human worktree branches. These tests lock in the
  // safety guards.

  it('does NOT delete non-UUID directories (human worktree branches)', async () => {
    // Simulate a human worktree at ~/worktrees/bde/fix-some-bug/ with
    // src/, docs/, .github/ inside — exactly the structure that got
    // nuked previously.
    const humanWorktree = path.join(tmpDir, 'fix-some-bug')
    const humanSrc = path.join(humanWorktree, 'src')
    const humanDocs = path.join(humanWorktree, 'docs')
    mkdirSync(humanSrc, { recursive: true })
    mkdirSync(humanDocs, { recursive: true })
    writeFileSync(path.join(humanWorktree, '.git'), 'gitdir: /real/path\n')

    const count = await pruneStaleWorktrees(tmpDir, () => false)

    expect(count).toBe(0)
    const { existsSync } = await import('node:fs')
    expect(existsSync(humanSrc)).toBe(true)
    expect(existsSync(humanDocs)).toBe(true)
  })

  it('does NOT delete task-ID-named directories without a .git entry', async () => {
    // Defense-in-depth: a directory whose name happens to match a BDE
    // task ID but isn't actually a git worktree (e.g. user has a
    // hex-named backup folder) must be left alone.
    const repoDir = path.join(tmpDir, 'repo-d')
    const fakeUuidDir = path.join(repoDir, TASK_ID_C)
    mkdirSync(fakeUuidDir, { recursive: true })
    // Note: NO .git file written

    const count = await pruneStaleWorktrees(tmpDir, () => false)

    expect(count).toBe(0)
    const { existsSync } = await import('node:fs')
    expect(existsSync(fakeUuidDir)).toBe(true)
  })

  it('uses the async readdir path — successfully prunes without calling readdirSync', async () => {
    // This test confirms the async enumeration path works end-to-end.
    // The synchronous readdirSync is no longer imported by worktree.ts — the
    // module import list is the authoritative check; this test validates the
    // runtime behavior: the pruner correctly enumerates and removes stale dirs
    // via the async path.
    makeWorktreeDir('repo-async', TASK_ID_A)

    execFileMock.mockClear()
    mockExecFileSuccess()

    const count = await pruneStaleWorktrees(tmpDir, () => false)

    // If async enumeration worked, the inactive worktree was found and pruned
    expect(count).toBe(1)
  })

  it('coexists safely with mixed BDE and human worktrees in same base', async () => {
    // Realistic scenario: ~/worktrees/bde/ contains both BDE-managed
    // task worktrees and human-created branch worktrees side by side.
    // The pruner should only issue rm -rf for BDE-managed inactive ones,
    // never for human worktree subdirectories.
    const bdeActive = makeWorktreeDir('bde', TASK_ID_A)
    const bdeInactive = makeWorktreeDir('bde', TASK_ID_B)
    const humanWorktree = path.join(tmpDir, 'fix-my-feature')
    const humanSrc = path.join(humanWorktree, 'src')
    const humanDocs = path.join(humanWorktree, 'docs')
    mkdirSync(humanSrc, { recursive: true })
    mkdirSync(humanDocs, { recursive: true })
    writeFileSync(path.join(humanWorktree, '.git'), 'gitdir: /real/path\n')

    // execFile is mocked at the top of this file. Clear call history
    // (the prune-test beforeEach doesn't reset, so calls from earlier
    // tests in this file would otherwise leak in) and wire it to succeed.
    execFileMock.mockClear()
    mockExecFileSuccess()

    const count = await pruneStaleWorktrees(tmpDir, (id) => id === TASK_ID_A)

    expect(count).toBe(1) // only the inactive BDE worktree

    // Inspect every rm invocation. The only acceptable target is the
    // inactive BDE worktree path. Anything inside the human worktree
    // (src, docs) or the active BDE worktree is a regression.
    const rmCalls = execFileMock.mock.calls.filter((c) => c[0] === 'rm')
    expect(rmCalls).toHaveLength(1)
    const rmArgs = rmCalls[0][1] as string[]
    expect(rmArgs).toEqual(['-rf', bdeInactive])

    // Belt-and-suspenders: assert nothing under the human worktree was targeted.
    for (const call of rmCalls) {
      const args = call[1] as string[]
      const target = args[args.length - 1]
      expect(target).not.toContain(humanSrc)
      expect(target).not.toContain(humanDocs)
      expect(target).not.toContain(humanWorktree)
      expect(target).not.toBe(bdeActive)
    }
  })
})

// ---------------------------------------------------------------------------
// Disk reservation prevents over-commit under concurrency
// ---------------------------------------------------------------------------

describe('disk reservation (F-t1-sre-5)', () => {
  it('reserveDisk increments reservation and releaseDisk decrements it', async () => {
    const { reserveDisk, releaseDisk, getPendingReservation, DISK_RESERVATION_BYTES } =
      await import('../worktree')

    const base = '/tmp/test-worktree-base'
    expect(getPendingReservation(base)).toBe(0)

    reserveDisk(base)
    expect(getPendingReservation(base)).toBe(DISK_RESERVATION_BYTES)

    reserveDisk(base)
    expect(getPendingReservation(base)).toBe(DISK_RESERVATION_BYTES * 2)

    releaseDisk(base)
    expect(getPendingReservation(base)).toBe(DISK_RESERVATION_BYTES)

    releaseDisk(base)
    expect(getPendingReservation(base)).toBe(0)

    // Map entry is removed when reservation reaches zero
    releaseDisk(base) // idempotent below zero
    expect(getPendingReservation(base)).toBe(0)
  })

  it('concurrent reservations add up so disk check sees cumulative headroom needed', async () => {
    const { reserveDisk, releaseDisk, getPendingReservation, DISK_RESERVATION_BYTES } =
      await import('../worktree')

    const base = '/tmp/test-concurrent-base'

    // Simulate 3 concurrent setupWorktree calls all reserving before any finishes
    reserveDisk(base)
    reserveDisk(base)
    reserveDisk(base)

    expect(getPendingReservation(base)).toBe(DISK_RESERVATION_BYTES * 3)

    // Clean up
    releaseDisk(base)
    releaseDisk(base)
    releaseDisk(base)
    expect(getPendingReservation(base)).toBe(0)
  })
})
