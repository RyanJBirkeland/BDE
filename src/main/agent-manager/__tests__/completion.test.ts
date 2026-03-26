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
  updateTask: vi.fn(),
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
  updateTaskMock.mockResolvedValue(null)
}

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const mockRepo: ISprintTaskRepository = {
  getTask: vi.fn(),
  updateTask: (...args: [string, Record<string, unknown>]) => (updateTask as any)(...args),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockResolvedValue([]),
  getOrphanedTasks: vi.fn(),
  getActiveTaskCount: vi.fn().mockResolvedValue(0),
  claimTask: vi.fn(),
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
    repo: mockRepo,
  }

  beforeEach(() => {
    resetMocks()
    mockOnTaskTerminal.mockReset()
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('pushes the branch and creates PR, then updates task with PR info', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },                    // git rev-parse
      { stdout: '' },                                           // git status --porcelain (no uncommitted changes)
      { stdout: '1\n' },                                        // git rev-list --count (has commits)
      { stdout: '' },                                           // git push
      { stdout: '' },                                           // gh pr list (no existing PR)
      { stdout: 'abc123 first commit\n' },                      // git log (generatePrBody)
      { stdout: ' file.ts | 10 ++++\n' },                      // git diff --stat (generatePrBody)
      { stdout: 'https://github.com/owner/repo/pull/42\n' },   // gh pr create
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify git rev-parse was called with correct cwd
    const revParseCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('rev-parse')
    )
    expect(revParseCall).toBeDefined()
    expect((revParseCall![2] as { cwd: string }).cwd).toBe(opts.worktreePath)

    // Verify git push with branch
    const pushCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('push')
    )
    expect(pushCall).toBeDefined()
    const pushArgs = pushCall![1] as string[]
    expect(pushArgs).toContain('origin')
    expect(pushArgs).toContain('agent/add-login-page')

    // Verify gh pr list was called to check for existing PR
    const prListCall = calls.find(
      (c) => c[0] === 'gh' && Array.isArray(c[1]) && c[1].includes('list')
    )
    expect(prListCall).toBeDefined()
    const listArgs = prListCall![1] as string[]
    expect(listArgs).toContain('--head')
    expect(listArgs).toContain('agent/add-login-page')

    // Verify gh pr create with correct arguments
    const prCall = calls.find(
      (c) => c[0] === 'gh' && Array.isArray(c[1]) && c[1].includes('create')
    )
    expect(prCall).toBeDefined()
    const prArgs = prCall![1] as string[]
    expect(prArgs).toContain('--title')
    expect(prArgs).toContain(opts.title)
    expect(prArgs).toContain('--head')
    expect(prArgs).toContain('agent/add-login-page')
    expect(prArgs).toContain('--repo')
    expect(prArgs).toContain(opts.ghRepo)

    // Verify updateTask called with PR info
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      pr_status: 'open',
      pr_url: 'https://github.com/owner/repo/pull/42',
      pr_number: 42,
    })
  })

  it('uses existing PR when one already exists for the branch', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },                                       // git rev-parse
      { stdout: '' },                                                              // git status --porcelain
      { stdout: '1\n' },                                                           // git rev-list --count
      { stdout: '' },                                                              // git push
      { stdout: '{"url":"https://github.com/owner/repo/pull/99","number":99}\n' }, // gh pr list (existing PR)
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify gh pr list was called
    const prListCall = calls.find(
      (c) => c[0] === 'gh' && Array.isArray(c[1]) && c[1].includes('list')
    )
    expect(prListCall).toBeDefined()

    // Verify gh pr create was NOT called (since PR already exists)
    const prCreateCall = calls.find(
      (c) => c[0] === 'gh' && Array.isArray(c[1]) && c[1].includes('create')
    )
    expect(prCreateCall).toBeUndefined()

    // Verify updateTask called with existing PR info
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      pr_status: 'open',
      pr_url: 'https://github.com/owner/repo/pull/99',
      pr_number: 99,
    })
  })

  it('recovers PR info from "already exists" error in gh pr create catch block', async () => {
    // Use implementation-based mock to track calls by command
    let callIndex = 0
    const responses = [
      { stdout: 'agent/add-login-page\n' },                                        // 0: git rev-parse
      { stdout: '' },                                                               // 1: git status --porcelain
      { stdout: '1\n' },                                                            // 2: git rev-list --count
      { stdout: '' },                                                               // 3: git push
      { stdout: '' },                                                               // 4: gh pr list (no existing PR — race condition)
      { stdout: '' },                                                               // 5: git log (generatePrBody)
      { stdout: '' },                                                               // 6: git diff --stat (generatePrBody)
      { error: new Error('a pull request already exists for branch agent/add-login-page') }, // 7: gh pr create fails
      { stdout: '{"url":"https://github.com/owner/repo/pull/77","number":77}\n' }, // 8: gh pr list retry
    ] as Array<{ stdout?: string; error?: Error }>
    getCustomMock().mockImplementation((..._args: unknown[]) => {
      const resp = responses[callIndex] ?? { stdout: '' }
      callIndex++
      if (resp.error) return Promise.reject(resp.error)
      return Promise.resolve({ stdout: resp.stdout ?? '', stderr: '' })
    })

    await resolveSuccess(opts, noopLogger)

    // Verify total call count matches our expectations
    expect(callIndex).toBe(9)

    // Should recover and set PR info from the retry fetch
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      pr_status: 'open',
      pr_url: 'https://github.com/owner/repo/pull/77',
      pr_number: 77,
    })
  })

  it('pushes branch and records notes when gh pr create fails (does not set pr_status=open)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },             // git rev-parse
      { stdout: '' },                                    // git status --porcelain
      { stdout: '1\n' },                                 // git rev-list --count
      { stdout: '' },                                    // git push
      { stdout: '' },                                    // gh pr list (no existing PR)
      { stdout: '' },                                    // git log (generatePrBody)
      { stdout: '' },                                    // git diff --stat (generatePrBody)
      { error: new Error('gh: authentication error') }, // gh pr create fails
    ])

    // Should not throw — user can create PR manually
    await resolveSuccess(opts, noopLogger)

    // Should NOT set pr_status=open when PR creation failed
    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.pr_status).toBeUndefined()
    expect(patch.pr_url).toBeUndefined()
    expect(patch.pr_number).toBeUndefined()

    // Should record branch name in notes so user can create PR manually
    expect(patch.notes).toBe('Branch agent/add-login-page pushed but PR creation failed')
  })

  it('sets task to error and calls onTaskTerminal when branch detection fails', async () => {
    mockExecFileSequence([
      { error: new Error('fatal: not a git repository') }, // git rev-parse fails
    ])

    await resolveSuccess(opts, noopLogger)

    // Should set status to error
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'error',
      completed_at: expect.any(String),
      notes: 'Failed to detect branch',
      claimed_by: null,
    })

    // Should call onTaskTerminal with 'error'
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'error')
  })

  it('marks error with "Worktree evicted" when worktree path does not exist', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)

    await resolveSuccess(opts, noopLogger)

    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, expect.objectContaining({
      status: 'error',
      notes: expect.stringContaining('Worktree evicted'),
    }))
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'error')
  })

  it('requeues task via resolveFailure when no commits to push (retry_count < MAX_RETRIES)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },   // git rev-parse
      { stdout: '' },                           // git status --porcelain (clean)
      { stdout: '0\n' },                        // git rev-list --count (no commits)
    ])

    await resolveSuccess(opts, noopLogger)

    // Should requeue via resolveFailure
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, expect.objectContaining({
      status: 'queued',
      retry_count: 1,
    }))

    // onTaskTerminal should NOT have been called (not terminal)
    expect(mockOnTaskTerminal).not.toHaveBeenCalled()
  })

  it('marks task failed via resolveFailure when no commits and retries exhausted', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },   // git rev-parse
      { stdout: '' },                           // git status --porcelain (clean)
      { stdout: '0\n' },                        // git rev-list --count (no commits)
    ])

    await resolveSuccess({ ...opts, retryCount: MAX_RETRIES }, noopLogger)

    // Should mark as failed
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, expect.objectContaining({
      status: 'failed',
    }))

    // onTaskTerminal should have been called with 'failed'
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'failed')
  })

  it('includes agent summary in no-commits notes', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },   // git rev-parse
      { stdout: '' },                           // git status --porcelain (clean)
      { stdout: '0\n' },                        // git rev-list --count (no commits)
    ])

    await resolveSuccess({
      ...opts,
      agentSummary: 'I could not complete the task because the API was down',
    }, noopLogger)

    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, expect.objectContaining({
      notes: expect.stringContaining('I could not complete the task'),
    }))
  })

  it('uses git add -A (not -u) in auto-commit to capture new files', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },                    // git rev-parse
      { stdout: ' M src/file.ts\n' },                           // git status --porcelain (dirty)
      { stdout: '' },                                           // git add -A
      { stdout: '' },                                           // git commit
      { stdout: '1\n' },                                        // git rev-list --count
      { stdout: '' },                                           // git push
      { stdout: '' },                                           // gh pr list
      { stdout: '' },                                           // git log
      { stdout: '' },                                           // git diff --stat
      { stdout: 'https://github.com/owner/repo/pull/42\n' },   // gh pr create
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>
    const addCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('add')
    )
    expect(addCall).toBeDefined()
    expect(addCall![1]).toContain('-A')
    expect(addCall![1]).not.toContain('-u')
  })

  it('records push failure in notes but does not call onTaskTerminal', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' },              // git rev-parse
      { stdout: '' },                                      // git status --porcelain
      { stdout: '1\n' },                                   // git rev-list --count
      { error: new Error('failed to push some refs') },   // git push fails
    ])

    await resolveSuccess(opts, noopLogger)

    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      notes: expect.stringContaining('git push failed'),
    })
    expect(mockOnTaskTerminal).not.toHaveBeenCalled()
  })
  it('sets task to error and calls onTaskTerminal when branch name is empty', async () => {
    mockExecFileSequence([
      { stdout: '' }, // git rev-parse returns empty string
    ])

    await resolveSuccess(opts, noopLogger)

    // Should set status to error
    expect(updateTaskMock).toHaveBeenCalledWith(opts.taskId, {
      status: 'error',
      completed_at: expect.any(String),
      notes: 'Empty branch name',
      claimed_by: null,
    })

    // Should call onTaskTerminal with 'error'
    expect(mockOnTaskTerminal).toHaveBeenCalledWith(opts.taskId, 'error')
  })
})

describe('resolveSuccess — catch handler coverage', () => {
  const mockOnTaskTerminal2 = vi.fn()
  const catchOpts = { taskId: 'task-catch', worktreePath: '/tmp/worktrees/task-catch', title: 'Catch test', ghRepo: 'owner/repo', onTaskTerminal: mockOnTaskTerminal2, repo: mockRepo }

  beforeEach(() => { resetMocks(); mockOnTaskTerminal2.mockReset(); vi.mocked(existsSync).mockReturnValue(true) })

  it('logs warning when updateTask fails after push error (line 152)', async () => {
    let i = 0
    const r = [{ stdout: 'agent/b\n' }, { stdout: '' }, { stdout: '1\n' }, { error: new Error('push failed') }] as any[]
    getCustomMock().mockImplementation(() => { const x = r[i] ?? { stdout: '' }; i++; return x.error ? Promise.reject(x.error) : Promise.resolve({ stdout: x.stdout ?? '', stderr: '' }) })
    updateTaskMock.mockRejectedValueOnce(new Error('DB down'))
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-catch after push error'))
  })

  it('logs warning when gh pr list fails during existing PR check (line 176)', async () => {
    let i = 0
    const r = [{ stdout: 'agent/b\n' }, { stdout: '' }, { stdout: '1\n' }, { stdout: '' }, { error: new Error('gh CLI crash') }, { stdout: '' }, { stdout: '' }, { stdout: 'https://github.com/o/r/pull/10\n' }] as any[]
    getCustomMock().mockImplementation(() => { const x = r[i] ?? { stdout: '' }; i++; return x.error ? Promise.reject(x.error) : Promise.resolve({ stdout: x.stdout ?? '', stderr: '' }) })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to check for existing PR'))
  })

  it('logs warning when retry PR list fails after "already exists" error (line 213)', async () => {
    let i = 0
    const r = [{ stdout: 'agent/b\n' }, { stdout: '' }, { stdout: '1\n' }, { stdout: '' }, { stdout: '' }, { stdout: '' }, { stdout: '' }, { error: new Error('a pull request already exists for branch') }, { error: new Error('gh CLI down') }] as any[]
    getCustomMock().mockImplementation(() => { const x = r[i] ?? { stdout: '' }; i++; return x.error ? Promise.reject(x.error) : Promise.resolve({ stdout: x.stdout ?? '', stderr: '' }) })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch existing PR after creation failure'))
  })

  it('logs error when final updateTask with PR info fails (line 231)', async () => {
    mockExecFileSequence([{ stdout: 'agent/b\n' }, { stdout: '' }, { stdout: '1\n' }, { stdout: '' }, { stdout: '{"url":"https://github.com/o/r/pull/1","number":1}\n' }])
    updateTaskMock.mockRejectedValueOnce(new Error('DB error'))
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-catch with PR info'))
  })

  it('handles generatePrBody when git log and diff both fail', async () => {
    let i = 0
    const r = [{ stdout: 'agent/b\n' }, { stdout: '' }, { stdout: '1\n' }, { stdout: '' }, { stdout: '' }, { error: new Error('git log failed') }, { error: new Error('git diff failed') }, { stdout: 'https://github.com/o/r/pull/55\n' }] as any[]
    getCustomMock().mockImplementation(() => { const x = r[i] ?? { stdout: '' }; i++; return x.error ? Promise.reject(x.error) : Promise.resolve({ stdout: x.stdout ?? '', stderr: '' }) })
    await resolveSuccess(catchOpts, noopLogger)
    expect(updateTaskMock).toHaveBeenCalledWith(catchOpts.taskId, { pr_status: 'open', pr_url: 'https://github.com/o/r/pull/55', pr_number: 55 })
  })

  it('logs warning when updateTask fails after worktree eviction (line 73)', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    updateTaskMock.mockRejectedValueOnce(new Error('DB error'))
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-catch after worktree eviction'))
  })

  it('logs warning when updateTask fails after branch detection error (line 89)', async () => {
    mockExecFileSequence([{ error: new Error('not a git repository') }])
    updateTaskMock.mockRejectedValueOnce(new Error('DB error'))
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-catch after branch detection error'))
  })

  it('logs warning when updateTask fails after empty branch (line 98)', async () => {
    mockExecFileSequence([{ stdout: '\n' }])
    updateTaskMock.mockRejectedValueOnce(new Error('DB error'))
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-catch after empty branch'))
  })

  it('logs warning when updateTask fails in no-commits path (line 135)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/b\n' },  // git rev-parse
      { stdout: '' },            // git status --porcelain
      { stdout: '0\n' },         // git rev-list --count (0 commits)
    ])
    updateTaskMock.mockRejectedValueOnce(new Error('DB error'))
    await resolveSuccess({ ...catchOpts, agentSummary: 'some output' }, noopLogger)
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task task-catch after empty branch'))
  })
})

describe('resolveFailure', () => {
  beforeEach(() => {
    updateTaskMock.mockReset()
    updateTaskMock.mockResolvedValue(null)
  })

  it('re-queues task with incremented retry count when retries remain', async () => {
    const result = await resolveFailure({ taskId: 'task-2', retryCount: 1, repo: mockRepo })

    expect(updateTaskMock).toHaveBeenCalledWith('task-2', {
      status: 'queued',
      retry_count: 2,
      claimed_by: null,
    })
    expect(result).toBe(false) // not terminal
  })

  it('marks task failed when retry count is exhausted', async () => {
    const result = await resolveFailure({ taskId: 'task-3', retryCount: MAX_RETRIES, repo: mockRepo })

    expect(updateTaskMock).toHaveBeenCalledOnce()
    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.status).toBe('failed')
    expect(typeof patch.completed_at).toBe('string')
    expect(result).toBe(true) // terminal
  })

  it('re-queues when retryCount is one below MAX_RETRIES', async () => {
    const result = await resolveFailure({ taskId: 'task-4', retryCount: MAX_RETRIES - 1, repo: mockRepo })

    expect(updateTaskMock).toHaveBeenCalledWith('task-4', {
      status: 'queued',
      retry_count: MAX_RETRIES,
      claimed_by: null,
    })
    expect(result).toBe(false) // not terminal
  })

  it('includes notes when provided', async () => {
    const result = await resolveFailure({ taskId: 'task-6', retryCount: 0, notes: 'Agent produced no commits', repo: mockRepo })

    expect(updateTaskMock).toHaveBeenCalledWith('task-6', expect.objectContaining({
      status: 'queued',
      retry_count: 1,
      notes: 'Agent produced no commits',
    }))
    expect(result).toBe(false)
  })

  it('includes notes in terminal failure', async () => {
    const result = await resolveFailure({ taskId: 'task-7', retryCount: MAX_RETRIES, notes: 'Agent produced no commits', repo: mockRepo })

    expect(updateTaskMock).toHaveBeenCalledWith('task-7', expect.objectContaining({
      status: 'failed',
      notes: 'Agent produced no commits',
    }))
    expect(result).toBe(true)
  })

  it('returns false when updateTask throws', async () => {
    updateTaskMock.mockRejectedValueOnce(new Error('DB error'))

    const result = await resolveFailure({ taskId: 'task-5', retryCount: MAX_RETRIES, repo: mockRepo })

    expect(result).toBe(false) // not terminal because the update failed
  })
})
