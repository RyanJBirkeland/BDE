import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'

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
      { stdout: '' }, // git commit
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
      { stdout: '' }, // git commit
      { stdout: '1\n' } // git rev-list --count
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>
    const addCall = calls.find((c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('add'))
    expect(addCall).toBeDefined()
    expect(addCall![1]).toContain('-A')
    expect(addCall![1]).not.toContain('-u')
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
    mockExecFileSequence([{ stdout: 'agent/b\n' }, { stdout: '' }, { stdout: '1\n' }])
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
    mockExecFileSequence([{ stdout: 'agent/b\n' }, { stdout: '' }, { stdout: '1\n' }])
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

    expect(updateTaskMock).toHaveBeenCalledWith('task-2', {
      status: 'queued',
      retry_count: 2,
      claimed_by: null
    })
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

    expect(updateTaskMock).toHaveBeenCalledWith('task-4', {
      status: 'queued',
      retry_count: MAX_RETRIES,
      claimed_by: null
    })
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
        notes: 'Agent produced no commits'
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
        notes: 'Agent produced no commits'
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
