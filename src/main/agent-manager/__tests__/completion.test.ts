import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'
import { sanitizeForGit, classifyFailureReason } from '../completion'

// Mock node:fs — existsSync must return true for worktree path guard
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: vi.fn(() => true) }
})

// Mock node:child_process before importing module under test.
// We attach util.promisify.custom so that promisify(execFile) resolves to { stdout, stderr }
// (matching real execFile behaviour) rather than the raw second callback argument.
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  execFile[promisify.custom] = vi.fn()
  return { execFile }
})

// Mock sprint-queries
vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn()
}))

// Mock broadcast — completion.ts calls broadcast() which requires Electron's BrowserWindow
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn()
}))

import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { updateTask } from '../../data/sprint-queries'
import { resolveSuccess, resolveFailure } from '../completion'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'
import { MAX_RETRIES } from '../types'

const execFileMock = vi.mocked(execFile)
const updateTaskMock = vi.mocked(updateTask)

// completion.ts uses promisify(execFile). Because execFile[promisify.custom] is set,
// promisify will delegate to the custom fn. We track calls there.
function getCustomMock(): ReturnType<typeof vi.fn> {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom]
}

function mockExecFileSequence(responses: Array<{ stdout?: string; error?: Error }>) {
  let callIndex = 0
  getCustomMock().mockImplementation((..._args: unknown[]) => {
    const resp = responses[callIndex] ?? { stdout: '' }
    callIndex++
    if (resp.error) return Promise.reject(resp.error)
    return Promise.resolve({ stdout: resp.stdout ?? '', stderr: '' })
  })
}

function resetMocks() {
  getCustomMock().mockReset()
  updateTaskMock.mockReset()
  updateTaskMock.mockReturnValue(null)
}

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const mockRepo: ISprintTaskRepository = {
  getTask: vi.fn(),
  updateTask: (...args: [string, Record<string, unknown>]) => (updateTask as any)(...args),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: vi.fn(),
  getActiveTaskCount: vi.fn().mockReturnValue(0),
  claimTask: vi.fn()
}

describe('resolveSuccess', () => {
  const mockOnTaskTerminal = vi.fn()
  const opts = {
    taskId: 'task-1',
    worktreePath: '/tmp/worktrees/task-1',
    title: 'Add login page',
    ghRepo: 'owner/repo',
    onTaskTerminal: mockOnTaskTerminal,
    retryCount: 0,
    repo: mockRepo
  }

  beforeEach(() => {
    resetMocks()
    mockOnTaskTerminal.mockReset()
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('transitions task to review status with worktree_path when agent has commits', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (no uncommitted changes)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '1\n' } // git rev-list --count (has commits)
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify git rev-parse was called with correct cwd
    const revParseCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('rev-parse')
    )
    expect(revParseCall).toBeDefined()
    expect((revParseCall![2] as { cwd: string }).cwd).toBe(opts.worktreePath)

    // Verify NO push or PR creation happened
    const pushCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('push')
    )
    expect(pushCall).toBeUndefined()

    const prCall = calls.find(
      (c) => c[0] === 'gh' && Array.isArray(c[1]) && c[1].includes('create')
    )
    expect(prCall).toBeUndefined()

    // Verify updateTask sets review status with worktree_path preserved
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'review',
      worktree_path: opts.worktreePath,
      claimed_by: null
    })

    // onTaskTerminal should NOT be called — review is not terminal
    expect(mockOnTaskTerminal).not.toHaveBeenCalled()
  })

  it('auto-commits dirty worktree then transitions to review', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: ' M src/file.ts\n' }, // git status --porcelain (dirty)
      { stdout: '' }, // git add -A
      { stdout: '' }, // git rm --cached test-results/
      { stdout: '' }, // git rm --cached coverage/
      { stdout: '' }, // git rm --cached *.log
      { stdout: '' }, // git rm --cached playwright-report/
      { stdout: 'src/file.ts\n' }, // git diff --cached --name-only (changes remain)
      { stdout: '' }, // git commit
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '1\n' } // git rev-list --count (has commits after auto-commit)
    ])

    await resolveSuccess(opts, noopLogger)

    // Verify updateTask sets review status
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'review',
      worktree_path: opts.worktreePath,
      claimed_by: null
    })

    // onTaskTerminal should NOT be called
    expect(mockOnTaskTerminal).not.toHaveBeenCalled()
  })

  it('sets task to error and calls onTaskTerminal when branch detection fails', async () => {
    mockExecFileSequence([
      { error: new Error('fatal: not a git repository') } // git rev-parse fails
    ])

    await resolveSuccess(opts, noopLogger)

    // Should set status to error
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'error',
      completed_at: expect.any(String),
      notes: 'Failed to detect branch',
      claimed_by: null
    })

    // Should call onTaskTerminal with 'error'
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'error')
  })

  it('marks error with "Worktree evicted" when worktree path does not exist', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)

    await resolveSuccess(opts, noopLogger)

    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'error',
        notes: expect.stringContaining('Worktree evicted')
      })
    )
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'error')
  })

  it('requeues task via resolveFailure when no commits to push (retry_count < MAX_RETRIES)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (clean)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '0\n' } // git rev-list --count (no commits)
    ])

    await resolveSuccess(opts, noopLogger)

    // Should requeue via resolveFailure
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'queued',
        retry_count: 1
      })
    )

    // onTaskTerminal should NOT have been called (not terminal)
    expect(mockOnTaskTerminal).not.toHaveBeenCalled()
  })

  it('marks task failed via resolveFailure when no commits and retries exhausted', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (clean)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '0\n' } // git rev-list --count (no commits)
    ])

    await resolveSuccess({ ...opts, retryCount: MAX_RETRIES }, noopLogger)

    // Should mark as failed
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'failed'
      })
    )

    // onTaskTerminal should have been called with 'failed'
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'failed')
  })

  it('includes agent summary in no-commits notes', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (clean)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '0\n' } // git rev-list --count (no commits)
    ])

    await resolveSuccess(
      {
        ...opts,
        agentSummary: 'I could not complete the task because the API was down'
      },
      noopLogger
    )

    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        notes: expect.stringContaining('I could not complete the task')
      })
    )
  })

  it('uses git add -A (not -u) in auto-commit to capture new files', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: ' M src/file.ts\n' }, // git status --porcelain (dirty)
      { stdout: '' }, // git add -A
      { stdout: '' }, // git rm --cached test-results/
      { stdout: '' }, // git rm --cached coverage/
      { stdout: '' }, // git rm --cached *.log
      { stdout: '' }, // git rm --cached playwright-report/
      { stdout: 'src/file.ts\n' }, // git diff --cached --name-only (changes remain)
      { stdout: '' }, // git commit
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '1\n' } // git rev-list --count
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>
    const addCall = calls.find((c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('add'))
    expect(addCall).toBeDefined()
    expect(addCall![1]).toContain('-A')
    expect(addCall![1]).not.toContain('-u')
  })

  it('rebases onto origin/main after auto-commit', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (clean)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '1\n' } // git rev-list --count
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify fetch was called
    const fetchCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('fetch')
    )
    expect(fetchCall).toBeDefined()
    expect(fetchCall![1]).toEqual(['fetch', 'origin', 'main'])

    // Verify rebase was called
    const rebaseCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('rebase') && c[1].length === 2
    )
    expect(rebaseCall).toBeDefined()
    expect(rebaseCall![1]).toEqual(['rebase', 'origin/main'])

    // Task should transition to review without rebase note
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'review',
      worktree_path: opts.worktreePath,
      claimed_by: null
    })
  })

  it('includes rebase conflict note when rebase fails', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (clean)
      { stdout: '' }, // git fetch origin main
      { error: new Error('CONFLICT (content): Merge conflict in src/file.ts') }, // git rebase origin/main fails
      { stdout: '' }, // git rebase --abort
      { stdout: '1\n' } // git rev-list --count
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify rebase --abort was called
    const abortCall = calls.find(
      (c) =>
        c[0] === 'git' &&
        Array.isArray(c[1]) &&
        c[1].includes('rebase') &&
        c[1].includes('--abort')
    )
    expect(abortCall).toBeDefined()

    // Task should transition to review WITH rebase note
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'review',
      worktree_path: opts.worktreePath,
      claimed_by: null,
      notes: 'Rebase onto main failed — manual conflict resolution needed.'
    })
  })

  it('unstages test artifacts after git add -A', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: ' M src/file.ts\n' }, // git status --porcelain (dirty)
      { stdout: '' }, // git add -A
      { stdout: '' }, // git rm --cached test-results/
      { stdout: '' }, // git rm --cached coverage/
      { stdout: '' }, // git rm --cached *.log
      { stdout: '' }, // git rm --cached playwright-report/
      { stdout: 'src/file.ts\n' }, // git diff --cached --name-only (changes remain)
      { stdout: '' }, // git commit
      { stdout: '1\n' } // git rev-list --count
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify git rm --cached was called for each artifact path
    const rmCalls = calls.filter(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('rm')
    )
    expect(rmCalls).toHaveLength(4)

    // Verify each artifact path was unstaged
    const rmArgs = rmCalls.map((c) => c[1])
    expect(rmArgs.some((args) => args.includes('test-results/'))).toBe(true)
    expect(rmArgs.some((args) => args.includes('coverage/'))).toBe(true)
    expect(rmArgs.some((args) => args.includes('*.log'))).toBe(true)
    expect(rmArgs.some((args) => args.includes('playwright-report/'))).toBe(true)

    // All rm calls should use --cached and --ignore-unmatch
    rmCalls.forEach((call) => {
      expect(call[1]).toContain('--cached')
      expect(call[1]).toContain('--ignore-unmatch')
    })
  })

  it('skips commit when only test artifacts were staged (all changes unstaged)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: ' M test-results/results.json\n' }, // git status --porcelain (dirty — only test artifact)
      { stdout: '' }, // git add -A
      { stdout: '' }, // git rm --cached test-results/
      { stdout: '' }, // git rm --cached coverage/
      { stdout: '' }, // git rm --cached *.log
      { stdout: '' }, // git rm --cached playwright-report/
      { stdout: '' }, // git diff --cached --name-only (empty — no changes remain after unstaging)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '0\n' } // git rev-list --count (no commits)
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify git commit was NOT called
    const commitCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('commit')
    )
    expect(commitCall).toBeUndefined()

    // Verify logger reported skipping commit
    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('no staged changes after unstaging test artifacts')
    )

    // Should proceed to no-commits handler (requeue via resolveFailure)
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'queued',
        retry_count: 1
      })
    )
  })

  it('sets task to error and calls onTaskTerminal when branch name is empty', async () => {
    mockExecFileSequence([
      { stdout: '' } // git rev-parse returns empty string
    ])

    await resolveSuccess(opts, noopLogger)

    // Should set status to error
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'error',
      completed_at: expect.any(String),
      notes: 'Empty branch name',
      claimed_by: null
    })

    // Should call onTaskTerminal with 'error'
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'error')
  })
})

describe('resolveSuccess — catch handler coverage', () => {
  const mockOnTaskTerminal2 = vi.fn()
  const catchOpts = {
    taskId: 'task-catch',
    worktreePath: '/tmp/worktrees/task-catch',
    title: 'Catch test',
    ghRepo: 'owner/repo',
    onTaskTerminal: mockOnTaskTerminal2,
    repo: mockRepo
  }

  beforeEach(() => {
    resetMocks()
    mockOnTaskTerminal2.mockReset()
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('logs error when updateTask fails during review transition', async () => {
    mockExecFileSequence([
      { stdout: 'agent/b\n' },
      { stdout: '' },
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '1\n' }
    ])
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB down')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-catch to review status')
    )
    // onTaskTerminal should NOT be called — review is not terminal
    expect(mockOnTaskTerminal2).not.toHaveBeenCalled()
  })

  it('transitions to review with worktree_path preserved', async () => {
    mockExecFileSequence([
      { stdout: 'agent/b\n' },
      { stdout: '' },
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '1\n' }
    ])
    await resolveSuccess(catchOpts, noopLogger)
    expect(updateTaskMock).toHaveBeenCalledWith(catchOpts.taskId, {
      status: 'review',
      worktree_path: catchOpts.worktreePath,
      claimed_by: null
    })
  })

  it('logs warning when updateTask fails after worktree eviction (line 73)', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-catch after worktree eviction')
    )
  })

  it('logs warning when updateTask fails after branch detection error (line 89)', async () => {
    mockExecFileSequence([{ error: new Error('not a git repository') }])
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-catch after branch detection error')
    )
  })

  it('logs warning when updateTask fails after empty branch (line 98)', async () => {
    mockExecFileSequence([{ stdout: '\n' }])
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-catch after empty branch')
    )
  })

  it('logs error when updateTask fails in no-commits path (resolveFailure catch)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/b\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: '0\n' } // git rev-list --count (0 commits)
    ])
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    await resolveSuccess({ ...catchOpts, agentSummary: 'some output' }, noopLogger)
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-catch during failure resolution')
    )
  })
})

describe('resolveFailure', () => {
  beforeEach(() => {
    updateTaskMock.mockReset()
    updateTaskMock.mockReturnValue(null)
  })

  it('re-queues task with incremented retry count when retries remain', async () => {
    const result = await resolveFailure({ taskId: 'task-2', retryCount: 1, repo: mockRepo })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-2',
      expect.objectContaining({
        status: 'queued',
        retry_count: 2,
        claimed_by: null,
        next_eligible_at: expect.any(String)
      })
    )
    expect(result).toBe(false) // not terminal
  })

  it('marks task failed with needs_review when retry count is exhausted', async () => {
    const result = await resolveFailure({
      taskId: 'task-3',
      retryCount: MAX_RETRIES,
      repo: mockRepo
    })

    expect(updateTaskMock).toHaveBeenCalledOnce()
    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.status).toBe('failed')
    expect(typeof patch.completed_at).toBe('string')
    expect(result).toBe(true) // terminal
  })

  it('re-queues when retryCount is one below MAX_RETRIES', async () => {
    const result = await resolveFailure({
      taskId: 'task-4',
      retryCount: MAX_RETRIES - 1,
      repo: mockRepo
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-4',
      expect.objectContaining({
        status: 'queued',
        retry_count: MAX_RETRIES,
        claimed_by: null,
        next_eligible_at: expect.any(String)
      })
    )
    expect(result).toBe(false) // not terminal
  })

  it('includes notes when provided', async () => {
    const result = await resolveFailure({
      taskId: 'task-6',
      retryCount: 0,
      notes: 'Agent produced no commits',
      repo: mockRepo
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-6',
      expect.objectContaining({
        status: 'queued',
        retry_count: 1,
        notes: 'Agent produced no commits',
        failure_reason: 'unknown'
      })
    )
    expect(result).toBe(false)
  })

  it('includes notes in terminal failure', async () => {
    const result = await resolveFailure({
      taskId: 'task-7',
      retryCount: MAX_RETRIES,
      notes: 'Agent produced no commits',
      repo: mockRepo
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-7',
      expect.objectContaining({
        status: 'failed',
        notes: 'Agent produced no commits',
        failure_reason: 'unknown'
      })
    )
    expect(result).toBe(true)
  })

  it('classifies failure reason from notes when retrying', async () => {
    const result = await resolveFailure({
      taskId: 'task-8',
      retryCount: 0,
      notes: 'Invalid API key',
      repo: mockRepo
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-8',
      expect.objectContaining({
        status: 'queued',
        retry_count: 1,
        notes: 'Invalid API key',
        failure_reason: 'auth'
      })
    )
    expect(result).toBe(false)
  })

  it('classifies failure reason from notes when terminal', async () => {
    const result = await resolveFailure({
      taskId: 'task-9',
      retryCount: MAX_RETRIES,
      notes: 'npm test failed',
      repo: mockRepo
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-9',
      expect.objectContaining({
        status: 'failed',
        notes: 'npm test failed',
        failure_reason: 'test_failure'
      })
    )
    expect(result).toBe(true)
  })

  it('returns true when retries exhausted even if updateTask throws (AM-5)', async () => {
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })

    const result = await resolveFailure({
      taskId: 'task-5',
      retryCount: MAX_RETRIES,
      repo: mockRepo
    })

    // AM-5 fix: should return true (terminal) even though DB update failed
    expect(result).toBe(true)
  })
})

describe('sanitizeForGit', () => {
  it('strips backticks', () => {
    expect(sanitizeForGit('hello `world`')).toBe("hello 'world'")
  })

  it('neutralizes command substitution $()', () => {
    const input = 'task $(rm -rf /)'
    const result = sanitizeForGit(input)
    expect(result).not.toContain('$(')
  })

  it('neutralizes nested command substitution', () => {
    const input = 'fix $(echo $(whoami))'
    const result = sanitizeForGit(input)
    expect(result).not.toContain('$(')
  })

  it('strips markdown links keeping text', () => {
    expect(sanitizeForGit('[click](http://evil.com)')).toBe('click')
  })

  it('trims whitespace', () => {
    expect(sanitizeForGit('  hello  ')).toBe('hello')
  })
})

describe('classifyFailureReason', () => {
  it('returns "unknown" when notes are undefined', () => {
    expect(classifyFailureReason(undefined)).toBe('unknown')
  })

  it('returns "unknown" when notes are empty string', () => {
    expect(classifyFailureReason('')).toBe('unknown')
  })

  it('returns "unknown" when notes do not match any pattern', () => {
    expect(classifyFailureReason('Some random error message')).toBe('unknown')
  })

  describe('auth failures', () => {
    it('classifies "Invalid API key" as auth', () => {
      expect(classifyFailureReason('Invalid API key')).toBe('auth')
    })

    it('classifies "authentication failed" as auth', () => {
      expect(classifyFailureReason('authentication failed')).toBe('auth')
    })

    it('classifies "unauthorized" as auth', () => {
      expect(classifyFailureReason('Request unauthorized')).toBe('auth')
    })

    it('classifies "token expired" as auth', () => {
      expect(classifyFailureReason('OAuth token expired')).toBe('auth')
    })

    it('classifies "invalid token" as auth', () => {
      expect(classifyFailureReason('invalid token provided')).toBe('auth')
    })

    it('is case insensitive for auth', () => {
      expect(classifyFailureReason('INVALID API KEY')).toBe('auth')
    })
  })

  describe('timeout failures', () => {
    it('classifies "exceeded maximum runtime" as timeout', () => {
      expect(classifyFailureReason('Agent exceeded maximum runtime')).toBe('timeout')
    })

    it('classifies "timeout" as timeout', () => {
      expect(classifyFailureReason('Operation timeout')).toBe('timeout')
    })

    it('classifies "timed out" as timeout', () => {
      expect(classifyFailureReason('Request timed out')).toBe('timeout')
    })

    it('classifies "watchdog" as timeout', () => {
      expect(classifyFailureReason('Killed by watchdog')).toBe('timeout')
    })

    it('is case insensitive for timeout', () => {
      expect(classifyFailureReason('EXCEEDED MAXIMUM RUNTIME')).toBe('timeout')
    })
  })

  describe('test failures', () => {
    it('classifies "npm test failed" as test_failure', () => {
      expect(classifyFailureReason('npm test failed')).toBe('test_failure')
    })

    it('classifies "test failed" as test_failure', () => {
      expect(classifyFailureReason('Unit test failed')).toBe('test_failure')
    })

    it('classifies "vitest failed" as test_failure', () => {
      expect(classifyFailureReason('vitest failed with 3 errors')).toBe('test_failure')
    })

    it('classifies "jest failed" as test_failure', () => {
      expect(classifyFailureReason('jest failed')).toBe('test_failure')
    })

    it('classifies "tests failed" as test_failure', () => {
      expect(classifyFailureReason('5 tests failed')).toBe('test_failure')
    })

    it('is case insensitive for test failures', () => {
      expect(classifyFailureReason('NPM TEST FAILED')).toBe('test_failure')
    })
  })

  describe('compilation failures', () => {
    it('classifies "compilation error" as compilation', () => {
      expect(classifyFailureReason('compilation error in src/main.ts')).toBe('compilation')
    })

    it('classifies "compilation failed" as compilation', () => {
      expect(classifyFailureReason('compilation failed')).toBe('compilation')
    })

    it('classifies "tsc failed" as compilation', () => {
      expect(classifyFailureReason('tsc failed with errors')).toBe('compilation')
    })

    it('classifies "typescript error" as compilation', () => {
      expect(classifyFailureReason('typescript error: missing type')).toBe('compilation')
    })

    it('classifies "type error" as compilation', () => {
      expect(classifyFailureReason('type error at line 42')).toBe('compilation')
    })

    it('classifies "build failed" as compilation', () => {
      expect(classifyFailureReason('build failed')).toBe('compilation')
    })

    it('is case insensitive for compilation', () => {
      expect(classifyFailureReason('TSC FAILED')).toBe('compilation')
    })
  })

  describe('spawn failures', () => {
    it('classifies "spawn failed" as spawn', () => {
      expect(classifyFailureReason('spawn failed')).toBe('spawn')
    })

    it('classifies "failed to spawn" as spawn', () => {
      expect(classifyFailureReason('failed to spawn agent')).toBe('spawn')
    })

    it('classifies "ENOENT" as spawn', () => {
      expect(classifyFailureReason('Error: ENOENT command not found')).toBe('spawn')
    })

    it('classifies "command not found" as spawn', () => {
      expect(classifyFailureReason('sh: command not found: gh')).toBe('spawn')
    })

    it('is case insensitive for spawn', () => {
      expect(classifyFailureReason('SPAWN FAILED')).toBe('spawn')
    })
  })

  describe('priority - first match wins', () => {
    it('classifies auth before timeout when both patterns present', () => {
      const notes = 'Invalid API key caused timeout'
      expect(classifyFailureReason(notes)).toBe('auth')
    })

    it('classifies timeout before test when both patterns present', () => {
      const notes = 'Test timed out and tests failed'
      expect(classifyFailureReason(notes)).toBe('timeout')
    })
  })
})
