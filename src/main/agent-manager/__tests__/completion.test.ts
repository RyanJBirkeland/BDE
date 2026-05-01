import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'
import { classifyFailureReason } from '../failure-classifier'
import { sanitizeForGit } from '../pr-operations'

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
  forceUpdateTask: vi.fn()
}))

// Mock broadcast — completion.ts calls broadcastCoalesced() which requires Electron's BrowserWindow
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

// Stub default-branch detection so tests don't need to mock the additional
// `git symbolic-ref` call that resolveDefaultBranch now performs.
vi.mock('../../lib/default-branch', () => ({
  resolveDefaultBranch: vi.fn().mockResolvedValue('main')
}))

import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { updateTask } from '../../data/sprint-queries'
import { resolveSuccess, resolveFailure } from '../completion'
import { calculateRetryBackoff } from '../resolve-failure-phases'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import { MAX_RETRIES, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS } from '../types'

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

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn() }

const stubTask = {
  id: 'task-1',
  title: 'Add login page',
  repo: 'fleet',
  prompt: null,
  priority: 1,
  status: 'queued' as const,
  notes: null,
  spec: null,
  spec_type: 'feature',
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null as null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z'
}

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn().mockReturnValue(stubTask),
  updateTask: (...args: [string, Record<string, unknown>]) => (updateTask as any)(...args),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn().mockReturnValue(0),
  getActiveTaskCount: vi.fn().mockReturnValue(0),
  claimTask: vi.fn(),
  getGroup: vi.fn().mockReturnValue(null),
  getGroupTasks: vi.fn().mockReturnValue([]),
  getGroupsWithDependencies: vi.fn().mockReturnValue([])
}

function resetMocks() {
  getCustomMock().mockReset()
  updateTaskMock.mockReset()
  updateTaskMock.mockReturnValue(null)
  vi.mocked(mockRepo.getTask).mockReturnValue(stubTask)
}

const TERMINAL_STATUS_SET_COMPLETION = new Set(['done', 'cancelled', 'failed', 'error'])

// Reset the transition mock in beforeEach blocks that use it
function resetTaskStateServiceMock(
  mockTaskStateService: { transition: ReturnType<typeof vi.fn> },
  onTerminal?: ReturnType<typeof vi.fn>
) {
  mockTaskStateService.transition.mockReset()
  mockTaskStateService.transition.mockImplementation(
    async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
      if (onTerminal && TERMINAL_STATUS_SET_COMPLETION.has(status)) {
        await onTerminal(taskId, status)
      }
    }
  )
}

describe('resolveSuccess', () => {
  const mockOnTaskTerminal = vi.fn()

  // Provide a minimal TaskStateService mock that delegates to the mocked updateTask
  // so existing test assertions (checking updateTaskMock) keep working.
  const mockTaskStateService = {
    transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
      // Simulate terminal dispatch so onTaskTerminal assertions pass
      if (TERMINAL_STATUS_SET_COMPLETION.has(status)) {
        await mockOnTaskTerminal(taskId, status)
      }
    })
  }
  const opts = {
    taskId: 'task-1',
    worktreePath: '/tmp/worktrees/task-1',
    title: 'Add login page',
    ghRepo: 'owner/repo',
    onTaskTerminal: mockOnTaskTerminal,
    retryCount: 0,
    repo: mockRepo,
    unitOfWork: { runInTransaction: (fn: () => void) => fn() },
    taskStateService: mockTaskStateService as unknown as import('../../../services/task-state-service').TaskStateService
  }

  beforeEach(() => {
    resetMocks()
    mockOnTaskTerminal.mockReset()
    mockOnTaskTerminal.mockResolvedValue(undefined)
    resetTaskStateServiceMock(mockTaskStateService, mockOnTaskTerminal)
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('transitions task to review status with worktree_path when agent has commits', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (no uncommitted changes)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
      { stdout: '1\n' } // git rev-list --count (has commits)
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify git rev-parse was called with correct cwd
    const revParseCall = calls.find(
      (c) =>
        c[0] === 'git' &&
        Array.isArray(c[1]) &&
        c[1][0] === 'rev-parse' &&
        c[1][1] === '--abbrev-ref'
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

    // Verify updateTask sets review status with worktree_path and rebase fields
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'review',
        worktree_path: opts.worktreePath,
        claimed_by: null,
        fast_fail_count: 0,
        rebase_base_sha: 'abc123',
        rebased_at: expect.any(String),
        promoted_to_review_at: expect.any(String)
      })
    )

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
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
      { stdout: '1\n' } // git rev-list --count (has commits after auto-commit)
    ])

    await resolveSuccess(opts, noopLogger)

    // Verify updateTask sets review status with rebase fields
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'review',
        worktree_path: opts.worktreePath,
        claimed_by: null,
        fast_fail_count: 0,
        rebase_base_sha: 'abc123',
        rebased_at: expect.any(String),
        promoted_to_review_at: expect.any(String)
      })
    )

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
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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

    // Task should transition to review with rebase fields
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'review',
        worktree_path: opts.worktreePath,
        claimed_by: null,
        fast_fail_count: 0,
        rebase_base_sha: 'abc123',
        rebased_at: expect.any(String),
        promoted_to_review_at: expect.any(String)
      })
    )
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
        c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('rebase') && c[1].includes('--abort')
    )
    expect(abortCall).toBeDefined()

    // Task should transition to review WITH rebase note and null rebase fields
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'review',
        worktree_path: opts.worktreePath,
        claimed_by: null,
        fast_fail_count: 0,
        notes: 'Rebase onto main failed — manual conflict resolution needed.',
        rebase_base_sha: null,
        rebased_at: null,
        promoted_to_review_at: expect.any(String)
      })
    )
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
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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

  it('skips commit when working directory is clean', async () => {
    mockExecFileSequence([
      { stdout: 'agent/add-login-page\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain (clean — no uncommitted changes)
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
      { stdout: '1\n' } // git rev-list --count (has prior commits)
    ])

    await resolveSuccess(opts, noopLogger)

    const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>

    // Verify git commit was NOT called
    const commitCall = calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('commit')
    )
    expect(commitCall).toBeUndefined()

    // Task should still transition to review
    expect(updateTaskMock).toHaveBeenCalledWith(
      opts.taskId,
      expect.objectContaining({
        status: 'review',
        worktree_path: opts.worktreePath,
        claimed_by: null,
        fast_fail_count: 0,
        rebase_base_sha: 'abc123',
        rebased_at: expect.any(String),
        promoted_to_review_at: expect.any(String)
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
  const mockTaskStateService2 = {
    transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
      if (TERMINAL_STATUS_SET_COMPLETION.has(status)) {
        await mockOnTaskTerminal2(taskId, status)
      }
    })
  }
  const catchOpts = {
    taskId: 'task-catch',
    worktreePath: '/tmp/worktrees/task-catch',
    title: 'Catch test',
    ghRepo: 'owner/repo',
    onTaskTerminal: mockOnTaskTerminal2,
    repo: mockRepo,
    retryCount: 0,
    unitOfWork: { runInTransaction: (fn: () => void) => fn() },
    taskStateService: mockTaskStateService2 as unknown as import('../../../services/task-state-service').TaskStateService
  }

  beforeEach(() => {
    resetMocks()
    mockOnTaskTerminal2.mockReset()
    mockOnTaskTerminal2.mockResolvedValue(undefined)
    resetTaskStateServiceMock(mockTaskStateService2, mockOnTaskTerminal2)
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('falls back to failed when review transition throws (T-8 fix)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/b\n' },
      { stdout: '' },
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
      { stdout: '1\n' }
    ])
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB down')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to transition task task-catch to review status')
    )
    // T-8 fix: fallback to 'failed' so the task does not stay stuck active
    expect(mockOnTaskTerminal2).toHaveBeenCalledWith('task-catch', 'failed')
  })

  it('transitions to review with worktree_path preserved', async () => {
    mockExecFileSequence([
      { stdout: 'agent/b\n' },
      { stdout: '' },
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
      { stdout: '1\n' }
    ])
    await resolveSuccess(catchOpts, noopLogger)
    expect(updateTaskMock).toHaveBeenCalledWith(
      catchOpts.taskId,
      expect.objectContaining({
        status: 'review',
        worktree_path: catchOpts.worktreePath,
        claimed_by: null,
        fast_fail_count: 0,
        rebase_base_sha: 'abc123',
        rebased_at: expect.any(String),
        promoted_to_review_at: expect.any(String)
      })
    )
  })

  it('logs error when updateTask fails after worktree eviction', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to transition task task-catch to error')
    )
  })

  it('logs error when updateTask fails after branch detection error', async () => {
    mockExecFileSequence([{ error: new Error('not a git repository') }])
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to transition task task-catch to error')
    )
  })

  it('logs error when updateTask fails after empty branch', async () => {
    mockExecFileSequence([{ stdout: '\n' }])
    updateTaskMock.mockImplementationOnce(() => {
      throw new Error('DB error')
    })
    await resolveSuccess(catchOpts, noopLogger)
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to transition task task-catch to error')
    )
  })

  it('logs error when updateTask fails in no-commits path (resolveFailure catch)', async () => {
    mockExecFileSequence([
      { stdout: 'agent/b\n' }, // git rev-parse
      { stdout: '' }, // git status --porcelain
      { stdout: '' }, // git fetch origin main
      { stdout: '' }, // git rebase origin/main
      { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
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
  // Delegates transition writes to the mocked updateTask so existing assertions remain valid.
  const mockTaskStateServiceForFailure = {
    transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
      return { committed: true, dependentsResolved: true }
    })
  }

  beforeEach(() => {
    updateTaskMock.mockReset()
    updateTaskMock.mockReturnValue(null)
    mockTaskStateServiceForFailure.transition.mockReset()
    mockTaskStateServiceForFailure.transition.mockImplementation(
      async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
        updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
        return { committed: true, dependentsResolved: true }
      }
    )
  })

  it('re-queues task with incremented retry count when retries remain', async () => {
    const result = await resolveFailure({
      taskId: 'task-2',
      retryCount: 1,
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-2',
      expect.objectContaining({
        status: 'queued',
        retry_count: 2,
        claimed_by: null,
        next_eligible_at: expect.any(String)
      })
    )
    expect(result).toMatchObject({ isTerminal: false })
    expect(result.writeFailed).toBeFalsy()
  })

  it('marks task failed with needs_review when retry count is exhausted', async () => {
    const result = await resolveFailure({
      taskId: 'task-3',
      retryCount: MAX_RETRIES,
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
    })

    expect(updateTaskMock).toHaveBeenCalledOnce()
    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.status).toBe('failed')
    expect(typeof patch.completed_at).toBe('string')
    expect(result).toMatchObject({ isTerminal: true })
    expect(result.writeFailed).toBeFalsy()
  })

  it('re-queues when retryCount is one below MAX_RETRIES', async () => {
    const result = await resolveFailure({
      taskId: 'task-4',
      retryCount: MAX_RETRIES - 1,
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
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
    expect(result).toMatchObject({ isTerminal: false })
    expect(result.writeFailed).toBeFalsy()
  })

  it('includes notes when provided', async () => {
    const result = await resolveFailure({
      taskId: 'task-6',
      retryCount: 0,
      notes: 'Agent produced no commits',
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-6',
      expect.objectContaining({
        status: 'queued',
        retry_count: 1,
        notes: 'Agent produced no commits',
        failure_reason: 'no_commits'
      })
    )
    expect(result).toMatchObject({ isTerminal: false })
    expect(result.writeFailed).toBeFalsy()
  })

  it('includes notes in terminal failure', async () => {
    const result = await resolveFailure({
      taskId: 'task-7',
      retryCount: MAX_RETRIES,
      notes: 'Agent produced no commits',
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-7',
      expect.objectContaining({
        status: 'failed',
        notes: 'Agent produced no commits',
        failure_reason: 'no_commits'
      })
    )
    expect(result).toMatchObject({ isTerminal: true })
    expect(result.writeFailed).toBeFalsy()
  })

  it('classifies failure reason from notes when retrying', async () => {
    const result = await resolveFailure({
      taskId: 'task-8',
      retryCount: 0,
      notes: 'Invalid API key',
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
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
    expect(result).toMatchObject({ isTerminal: false })
    expect(result.writeFailed).toBeFalsy()
  })

  it('classifies failure reason from notes when terminal', async () => {
    const result = await resolveFailure({
      taskId: 'task-9',
      retryCount: MAX_RETRIES,
      notes: 'npm test failed',
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
    })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-9',
      expect.objectContaining({
        status: 'failed',
        notes: 'npm test failed',
        failure_reason: 'test_failure'
      })
    )
    expect(result).toMatchObject({ isTerminal: true })
    expect(result.writeFailed).toBeFalsy()
  })

  it('returns { writeFailed: true } when taskStateService throws — caller must NOT invoke onTaskTerminal', async () => {
    mockTaskStateServiceForFailure.transition.mockImplementationOnce(() => {
      throw new Error('DB error')
    })

    const result = await resolveFailure({
      taskId: 'task-5',
      retryCount: MAX_RETRIES,
      repo: mockRepo,
      taskStateService: mockTaskStateServiceForFailure as any
    })
    expect(result).toMatchObject({ writeFailed: true })
    expect(result).toHaveProperty('error')
  })
})

describe('calculateRetryBackoff', () => {
  // With ±20% jitter, results are in range [base*0.8, base*1.2].
  // For capped values, range is [cap*0.8, cap*1.2].

  it('returns base delay ±20% for first retry (retryCount=0)', () => {
    const result = calculateRetryBackoff(0)
    expect(result).toBeGreaterThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 0.8))
    expect(result).toBeLessThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 1.2))
  })

  it('doubles base delay ±20% for second retry (retryCount=1)', () => {
    const result = calculateRetryBackoff(1)
    expect(result).toBeGreaterThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 2 * 0.8))
    expect(result).toBeLessThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 2 * 1.2))
  })

  it('quadruples base delay ±20% for third retry (retryCount=2)', () => {
    const result = calculateRetryBackoff(2)
    expect(result).toBeGreaterThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 4 * 0.8))
    expect(result).toBeLessThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 4 * 1.2))
  })

  it('caps delay at RETRY_BACKOFF_CAP_MS ±20% for high retry counts', () => {
    // retryCount=10 would be 30000 * 2^10 = 30,720,000ms without cap
    const result = calculateRetryBackoff(10)
    expect(result).toBeGreaterThanOrEqual(Math.round(RETRY_BACKOFF_CAP_MS * 0.8))
    expect(result).toBeLessThanOrEqual(Math.round(RETRY_BACKOFF_CAP_MS * 1.2))
  })

  it('respects cap when exactly at threshold', () => {
    // 30000 * 2^4 = 480000 > 300000 cap
    const result = calculateRetryBackoff(4)
    expect(result).toBeGreaterThanOrEqual(Math.round(RETRY_BACKOFF_CAP_MS * 0.8))
    expect(result).toBeLessThanOrEqual(Math.round(RETRY_BACKOFF_CAP_MS * 1.2))
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
