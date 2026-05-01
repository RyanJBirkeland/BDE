/**
 * Integration test: Agent completion pipeline.
 *
 * Tests the end-to-end flow from agent exit through git operations,
 * PR creation, task status transitions, retry logic, and dependent
 * task unblocking.
 *
 * Mocked at the boundary:
 * - execFile (child_process) for git/gh CLI commands
 * - sprint-queries for Supabase task reads/writes
 * - env-utils returns a plain env object
 *
 * Real modules wired together:
 * - completion.ts (resolveSuccess / resolveFailure)
 * - resolve-dependents.ts
 * - dependency-index.ts (createDependencyIndex)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: vi.fn(() => true) }
})
vi.mock('node:child_process', () => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  fn[promisify.custom] = vi.fn()
  return { execFile: fn }
})

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn().mockReturnValue([]),
  listTasksRecent: vi.fn().mockReturnValue([])
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ ...process.env }))
}))

vi.mock('../../lib/default-branch', () => ({
  resolveDefaultBranch: vi.fn().mockResolvedValue('main')
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process'
import { updateTask, getTask } from '../../data/sprint-queries'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import { resolveSuccess, resolveFailure } from '../../agent-manager/completion'
import { resolveDependents } from '../../lib/resolve-dependents'
import { createDependencyIndex, type DependencyIndex } from '../../services/dependency-service'
import { MAX_RETRIES } from '../../agent-manager/types'
import type { TaskDependency } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const execFileMock = vi.mocked(execFile)

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

const updateTaskMock = vi.mocked(updateTask)

const mockRepo: IAgentTaskRepository = {
  getTask: (...args: [string]) => (getTask as any)(...args),
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
const getTaskMock = vi.mocked(getTask)

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn() }
}

/** Build a minimal task-like object for getTask mock returns */
function makeTaskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Add login page',
    status: 'active',
    notes: null,
    depends_on: null as TaskDependency[] | null,
    repo: 'myrepo',
    prompt: 'Build the feature',
    spec: null,
    priority: 1,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_url: null,
    claimed_by: 'fleet-embedded',
    started_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    template_name: null,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Mock TaskStateService that delegates to the mocked updateTask for test assertions
const mockTaskStateService = {
  transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
    updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
  })
} as unknown as import('../../services/task-state-service').TaskStateService

describe('Agent completion pipeline integration', () => {
  const logger = makeLogger()
  const onTaskTerminal = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockTaskStateService.transition as ReturnType<typeof vi.fn>).mockImplementation(
      async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
        updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
      }
    )
    updateTaskMock.mockReturnValue(null)
    getTaskMock.mockReturnValue(makeTaskRecord())
    onTaskTerminal.mockReset().mockResolvedValue(undefined)
  })

  // -------------------------------------------------------------------------
  // 1. Agent exits 0 with changes: auto-commit, transition to review status
  // -------------------------------------------------------------------------
  describe('agent exits 0 with changes', () => {
    it('transitions task to review status with worktree_path preserved (no push/PR)', async () => {
      mockExecFileSequence([
        { stdout: 'agent/add-login-page\n' }, // git rev-parse --abbrev-ref HEAD
        { stdout: '' }, // git status --porcelain (clean)
        { stdout: '' }, // git fetch origin main
        { stdout: '' }, // git rebase origin/main
        { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
        { stdout: '3\n' } // git rev-list --count
      ])

      await resolveSuccess(
        {
          repo: mockRepo,
          unitOfWork: { runInTransaction: (fn: () => void) => fn() },
          taskId: 'task-1',
          worktreePath: '/tmp/wt/task-1',
          title: 'Add login page',
          ghRepo: 'owner/repo',
          onTaskTerminal,
          retryCount: 0,
          taskStateService: mockTaskStateService
        },
        logger
      )

      // Verify NO git push was called (push deferred to review approval)
      const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>
      const pushCall = calls.find(
        (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('push')
      )
      expect(pushCall).toBeUndefined()

      // Verify NO PR was created
      const prCreateCall = calls.find(
        (c) => c[0] === 'gh' && Array.isArray(c[1]) && c[1].includes('create')
      )
      expect(prCreateCall).toBeUndefined()

      // Verify task updated to review status with worktree_path and rebase fields
      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'review',
          worktree_path: '/tmp/wt/task-1',
          claimed_by: null,
          fast_fail_count: 0,
          rebase_base_sha: 'abc123',
          rebased_at: expect.any(String),
          duration_ms: expect.any(Number),
          promoted_to_review_at: expect.any(String)
        })
      )

      // onTaskTerminal should NOT be called (review is not terminal)
      expect(onTaskTerminal).not.toHaveBeenCalled()
    })

    it('auto-commits uncommitted changes before transitioning to review', async () => {
      mockExecFileSequence([
        { stdout: 'agent/add-login-page\n' }, // git rev-parse
        { stdout: ' M src/file.ts\n' }, // git status --porcelain (dirty)
        { stdout: '' }, // git add -A
        { stdout: '' }, // git rm --cached test-results/
        { stdout: '' }, // git rm --cached coverage/
        { stdout: '' }, // git rm --cached *.log
        { stdout: '' }, // git rm --cached playwright-report/
        { stdout: 'src/file.ts\n' }, // git diff --cached --name-only
        { stdout: '' }, // git commit
        { stdout: '' }, // git fetch origin main
        { stdout: '' }, // git rebase origin/main
        { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
        { stdout: '2\n' } // git rev-list --count
      ])

      await resolveSuccess(
        {
          repo: mockRepo,
          unitOfWork: { runInTransaction: (fn: () => void) => fn() },
          taskId: 'task-1',
          worktreePath: '/tmp/wt/task-1',
          title: 'Add login page',
          ghRepo: 'owner/repo',
          onTaskTerminal,
          retryCount: 0,
          taskStateService: mockTaskStateService
        },
        logger
      )

      // Verify auto-commit sequence: git add -A then git commit
      const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>
      const addCall = calls.find(
        (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('add') && c[1].includes('-A')
      )
      expect(addCall).toBeDefined()

      const commitCall = calls.find(
        (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('commit')
      )
      expect(commitCall).toBeDefined()

      // Should update task to review status with rebase fields
      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'review',
          worktree_path: '/tmp/wt/task-1',
          claimed_by: null,
          fast_fail_count: 0,
          rebase_base_sha: 'abc123',
          rebased_at: expect.any(String),
          duration_ms: expect.any(Number),
          promoted_to_review_at: expect.any(String)
        })
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. Agent exits 0 with no changes: task error, no PR opened
  // -------------------------------------------------------------------------
  describe('agent exits 0 with no changes (empty diff)', () => {
    it('requeues task with incremented retry_count when no commits', async () => {
      mockExecFileSequence([
        { stdout: 'agent/empty-branch\n' }, // git rev-parse
        { stdout: '' }, // git status --porcelain (clean)
        { stdout: '' }, // git fetch origin main
        { stdout: '' }, // git rebase origin/main
        { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
        { stdout: '0\n' } // git rev-list (no commits)
      ])

      await resolveSuccess(
        {
          repo: mockRepo,
          unitOfWork: { runInTransaction: (fn: () => void) => fn() },
          taskId: 'task-2',
          worktreePath: '/tmp/wt/task-2',
          title: 'Empty task',
          ghRepo: 'owner/repo',
          onTaskTerminal,
          retryCount: 0,
          taskStateService: mockTaskStateService
        },
        logger
      )

      // No push should have happened
      const calls = getCustomMock().mock.calls as Array<[string, string[], unknown]>
      const pushCall = calls.find(
        (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('push')
      )
      expect(pushCall).toBeUndefined()

      // No PR creation
      const prCall = calls.find(
        (c) => c[0] === 'gh' && Array.isArray(c[1]) && c[1].includes('create')
      )
      expect(prCall).toBeUndefined()

      // Task requeued with incremented retry_count
      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({
          status: 'queued',
          retry_count: 1
        })
      )

      // onTaskTerminal NOT called (not terminal)
      expect(onTaskTerminal).not.toHaveBeenCalled()
    })

    it('marks task failed when no commits and retries exhausted', async () => {
      mockExecFileSequence([
        { stdout: 'agent/empty-branch\n' }, // git rev-parse
        { stdout: '' }, // git status --porcelain (clean)
        { stdout: '' }, // git fetch origin main
        { stdout: '' }, // git rebase origin/main
        { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
        { stdout: '0\n' } // git rev-list (no commits)
      ])

      await resolveSuccess(
        {
          repo: mockRepo,
          unitOfWork: { runInTransaction: (fn: () => void) => fn() },
          taskId: 'task-2',
          worktreePath: '/tmp/wt/task-2',
          title: 'Empty task',
          ghRepo: 'owner/repo',
          onTaskTerminal,
          retryCount: MAX_RETRIES,
          taskStateService: mockTaskStateService
        },
        logger
      )

      // Task marked as failed
      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({
          status: 'failed',
          claimed_by: null
        })
      )

      // onTaskTerminal called with 'failed'
      expect(onTaskTerminal).toHaveBeenCalledWith('task-2', 'failed')
    })

    it('includes agent summary in notes when available', async () => {
      mockExecFileSequence([
        { stdout: 'agent/empty-branch\n' }, // git rev-parse
        { stdout: '' }, // git status --porcelain (clean)
        { stdout: '' }, // git fetch origin main
        { stdout: '' }, // git rebase origin/main
        { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
        { stdout: '0\n' } // git rev-list (no commits)
      ])

      await resolveSuccess(
        {
          repo: mockRepo,
          unitOfWork: { runInTransaction: (fn: () => void) => fn() },
          taskId: 'task-2',
          worktreePath: '/tmp/wt/task-2',
          title: 'Empty task',
          ghRepo: 'owner/repo',
          onTaskTerminal,
          retryCount: 0,
          agentSummary: 'I could not complete the task because the API was down',
          taskStateService: mockTaskStateService
        },
        logger
      )

      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({
          notes: expect.stringContaining('I could not complete the task')
        })
      )
    })
  })

  // -------------------------------------------------------------------------
  // 3. Agent exits non-zero: retry or permanent failure
  // -------------------------------------------------------------------------
  describe('agent exits non-zero (resolveFailure)', () => {
    it('re-queues task with incremented retry count when under max retries', async () => {
      const result = await resolveFailure(
        { repo: mockRepo, taskId: 'task-3', retryCount: 0, taskStateService: mockTaskStateService },
        logger
      )

      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-3',
        expect.objectContaining({
          status: 'queued',
          retry_count: 1,
          claimed_by: null
        })
      )
      expect(result).toMatchObject({ isTerminal: false })
      expect(result.writeFailed).toBeFalsy()
    })

    it('re-queues at every retry count below MAX_RETRIES', async () => {
      for (let i = 0; i < MAX_RETRIES; i++) {
        updateTaskMock.mockClear()
        const result = await resolveFailure(
          { repo: mockRepo, taskId: 'task-3', retryCount: i, taskStateService: mockTaskStateService },
          logger
        )
        expect(updateTaskMock).toHaveBeenCalledWith(
          'task-3',
          expect.objectContaining({
            status: 'queued',
            retry_count: i + 1,
            claimed_by: null
          })
        )
        expect(result).toMatchObject({ isTerminal: false })
        expect(result.writeFailed).toBeFalsy()
      }
    })

    it('marks task permanently failed when retry count reaches MAX_RETRIES', async () => {
      const result = await resolveFailure(
        { repo: mockRepo, taskId: 'task-3', retryCount: MAX_RETRIES, taskStateService: mockTaskStateService },
        logger
      )

      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-3',
        expect.objectContaining({
          status: 'failed',
          claimed_by: null
        })
      )
      expect(result).toMatchObject({ isTerminal: true })
      expect(result.writeFailed).toBeFalsy()
    })

    it('returns { writeFailed: true } when taskStateService throws during failure resolution', async () => {
      vi.mocked(mockTaskStateService.transition as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('DB error')
      })

      // T-92: returns tagged result so caller can skip onTaskTerminal without
      // relying on exception propagation.
      const result = await resolveFailure({ repo: mockRepo, taskId: 'task-3', retryCount: MAX_RETRIES, taskStateService: mockTaskStateService }, logger)
      expect(result).toMatchObject({ writeFailed: true })
      expect(result).toHaveProperty('error')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Agent completes: blocked dependents get unblocked
  // -------------------------------------------------------------------------
  describe('completion triggers dependent task unblocking', () => {
    let depIndex: DependencyIndex

    beforeEach(() => {
      depIndex = createDependencyIndex()
    })

    it('unblocks a blocked dependent when parent completes as done', async () => {
      depIndex.rebuild([{ id: 'task-B', depends_on: [{ id: 'task-A', type: 'hard' }] }])

      getTaskMock.mockImplementation((id: string) => {
        if (id === 'task-B') {
          return makeTaskRecord({
            id: 'task-B',
            status: 'blocked',
            depends_on: [{ id: 'task-A', type: 'hard' }]
          }) as any
        }
        if (id === 'task-A') {
          return makeTaskRecord({ id: 'task-A', status: 'done' }) as any
        }
        return null
      })

      await resolveDependents('task-A', 'done', depIndex, getTask as any, updateTask, logger)

      expect(updateTaskMock).toHaveBeenCalledWith('task-B', { status: 'queued' })
    })

    it('does NOT unblock dependent when parent fails and dependency is hard', async () => {
      depIndex.rebuild([{ id: 'task-B', depends_on: [{ id: 'task-A', type: 'hard' }] }])

      getTaskMock.mockImplementation((id: string) => {
        if (id === 'task-B') {
          return makeTaskRecord({
            id: 'task-B',
            status: 'blocked',
            depends_on: [{ id: 'task-A', type: 'hard' }]
          }) as any
        }
        return null
      })

      await resolveDependents('task-A', 'failed', depIndex, getTask as any, updateTask, logger)

      const queueCall = updateTaskMock.mock.calls.find(
        (c) => c[0] === 'task-B' && (c[1] as Record<string, unknown>).status === 'queued'
      )
      expect(queueCall).toBeUndefined()
    })

    it('unblocks dependent with soft dependency when parent fails', async () => {
      depIndex.rebuild([{ id: 'task-B', depends_on: [{ id: 'task-A', type: 'soft' }] }])

      getTaskMock.mockImplementation((id: string) => {
        if (id === 'task-B') {
          return makeTaskRecord({
            id: 'task-B',
            status: 'blocked',
            depends_on: [{ id: 'task-A', type: 'soft' }]
          }) as any
        }
        if (id === 'task-A') {
          return makeTaskRecord({ id: 'task-A', status: 'failed' }) as any
        }
        return null
      })

      await resolveDependents('task-A', 'failed', depIndex, getTask as any, updateTask, logger)

      expect(updateTaskMock).toHaveBeenCalledWith('task-B', { status: 'queued' })
    })

    it('handles fan-in: only unblocks when ALL hard dependencies are satisfied', async () => {
      depIndex.rebuild([
        {
          id: 'task-C',
          depends_on: [
            { id: 'task-A', type: 'hard' },
            { id: 'task-B', type: 'hard' }
          ]
        }
      ])

      getTaskMock.mockImplementation((id: string) => {
        if (id === 'task-C') {
          return makeTaskRecord({
            id: 'task-C',
            status: 'blocked',
            depends_on: [
              { id: 'task-A', type: 'hard' },
              { id: 'task-B', type: 'hard' }
            ]
          }) as any
        }
        if (id === 'task-B') {
          return makeTaskRecord({ id: 'task-B', status: 'active' }) as any
        }
        return null
      })

      await resolveDependents('task-A', 'done', depIndex, getTask as any, updateTask, logger)

      const queueCall = updateTaskMock.mock.calls.find(
        (c) => c[0] === 'task-C' && (c[1] as Record<string, unknown>).status === 'queued'
      )
      expect(queueCall).toBeUndefined()

      const notesCall = updateTaskMock.mock.calls.find(
        (c) => c[0] === 'task-C' && (c[1] as Record<string, unknown>).notes !== undefined
      )
      expect(notesCall).toBeDefined()
      expect((notesCall![1] as Record<string, unknown>).notes).toContain('task-B')
    })

    it('fan-in: unblocks when the last dependency completes', async () => {
      depIndex.rebuild([
        {
          id: 'task-C',
          depends_on: [
            { id: 'task-A', type: 'hard' },
            { id: 'task-B', type: 'hard' }
          ]
        }
      ])

      getTaskMock.mockImplementation((id: string) => {
        if (id === 'task-C') {
          return makeTaskRecord({
            id: 'task-C',
            status: 'blocked',
            depends_on: [
              { id: 'task-A', type: 'hard' },
              { id: 'task-B', type: 'hard' }
            ]
          }) as any
        }
        if (id === 'task-A') {
          return makeTaskRecord({ id: 'task-A', status: 'done' }) as any
        }
        return null
      })

      await resolveDependents('task-B', 'done', depIndex, getTask as any, updateTask, logger)

      expect(updateTaskMock).toHaveBeenCalledWith('task-C', { status: 'queued' })
    })

    it('wires resolveSuccess onTaskTerminal callback to resolveDependents', async () => {
      depIndex.rebuild([{ id: 'task-dep', depends_on: [{ id: 'task-parent', type: 'hard' }] }])

      getTaskMock.mockImplementation((id: string) => {
        if (id === 'task-dep') {
          return makeTaskRecord({
            id: 'task-dep',
            status: 'blocked',
            depends_on: [{ id: 'task-parent', type: 'hard' }]
          }) as any
        }
        if (id === 'task-parent') {
          return makeTaskRecord({ id: 'task-parent', status: 'active' }) as any
        }
        return null
      })

      // Wire the real onTaskTerminal that triggers resolveDependents
      const onTerminal = vi.fn(async (taskId: string, status: string) => {
        await resolveDependents(taskId, status, depIndex, getTask as any, updateTask, logger)
      })

      // Parent task produced no commits (triggers error path)
      mockExecFileSequence([
        { stdout: 'agent/parent-branch\n' }, // git rev-parse
        { stdout: '' }, // git status --porcelain
        { stdout: '' }, // git fetch origin main
        { stdout: '' }, // git rebase origin/main
        { stdout: 'abc123\n' }, // git rev-parse origin/main (rebase base SHA)
        { stdout: '0\n' }, // git rev-list (no commits)
        { stdout: '' }, // logUncommittedWorktreeState: git diff HEAD
        { stdout: '' } // logUncommittedWorktreeState: git status --porcelain
      ])

      await resolveSuccess(
        {
          repo: mockRepo,
          unitOfWork: { runInTransaction: (fn: () => void) => fn() },
          taskId: 'task-parent',
          worktreePath: '/tmp/wt/task-parent',
          title: 'Parent task',
          ghRepo: 'owner/repo',
          onTaskTerminal: onTerminal,
          retryCount: MAX_RETRIES,
          taskStateService: mockTaskStateService
        },
        logger
      )

      // onTaskTerminal should have been called with 'failed'
      expect(onTerminal).toHaveBeenCalledWith('task-parent', 'failed')

      // Hard dep on error status does NOT unblock
      const queueCall = updateTaskMock.mock.calls.find(
        (c) => c[0] === 'task-dep' && (c[1] as Record<string, unknown>).status === 'queued'
      )
      expect(queueCall).toBeUndefined()
    })

    it('does not modify dependents that are not in blocked status', async () => {
      depIndex.rebuild([{ id: 'task-B', depends_on: [{ id: 'task-A', type: 'hard' }] }])

      getTaskMock.mockImplementation((id: string) => {
        if (id === 'task-B') {
          return makeTaskRecord({
            id: 'task-B',
            status: 'done',
            depends_on: [{ id: 'task-A', type: 'hard' }]
          }) as any
        }
        return null
      })

      await resolveDependents('task-A', 'done', depIndex, getTask as any, updateTask, logger)

      const taskBCalls = updateTaskMock.mock.calls.filter((c) => c[0] === 'task-B')
      expect(taskBCalls).toHaveLength(0)
    })
  })
})
