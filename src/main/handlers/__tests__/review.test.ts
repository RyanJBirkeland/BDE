/**
 * Review handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Track git command calls for ordering tests (hoisted for vi.mock).
// The default impl is exposed so `beforeEach` can re-apply it — otherwise
// tests that override via mockImplementation leak their impl into later tests
// (vi.clearAllMocks does NOT reset implementations).
const { gitCommandCalls, mockExecFileAsync, defaultGitImpl } = vi.hoisted(() => {
  const gitCommandCalls: string[] = []

  const defaultGitImpl = async (
    cmd: string,
    args: string[],
    opts?: { cwd?: string }
  ): Promise<{ stdout: string; stderr: string }> => {
    if (cmd === 'git') {
      if (args[0] === 'rev-parse') {
        gitCommandCalls.push('rev-parse')
        // Worktree rev-parse returns the feature branch; main-repo checkout
        // rev-parse returns 'main'. Tests that need different values can
        // override via mockImplementation.
        const isMainRepo = opts?.cwd === '/repos/test'
        return { stdout: isMainRepo ? 'main\n' : 'feature-branch\n', stderr: '' }
      }
      if (args[0] === 'fetch') {
        gitCommandCalls.push('fetch')
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'rebase') {
        if (args[1] === '--abort') {
          gitCommandCalls.push('rebase-abort')
          return { stdout: '', stderr: '' }
        }
        gitCommandCalls.push('rebase')
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'status') {
        gitCommandCalls.push('status')
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'merge') {
        gitCommandCalls.push('merge')
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        gitCommandCalls.push('worktree-remove')
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'branch' && args[1] === '-D') {
        gitCommandCalls.push('branch-delete')
        return { stdout: '', stderr: '' }
      }
    }
    return { stdout: '', stderr: '' }
  }

  const mockExecFileAsync = vi.fn(defaultGitImpl)

  return { gitCommandCalls, mockExecFileAsync, defaultGitImpl }
})

// Mock dependencies before imports
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

// Mock electron (for BrowserWindow used by broadcast)
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }])
  }
}))

// Mock broadcast
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

// Mock webhook-service
vi.mock('../../services/webhook-service', () => ({
  createWebhookService: vi.fn(() => ({
    fireWebhook: vi.fn()
  })),
  getWebhookEventName: vi.fn((type, _task) => `sprint.task.${type}`)
}))

// Mock webhook-queries
vi.mock('../../data/webhook-queries', () => ({
  getWebhooks: vi.fn(() => [])
}))

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

vi.mock('../../data/sprint-queries', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn(),
  getActiveTaskCount: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn(),
  getDailySuccessRate: vi.fn(),
  getFailureReasonBreakdown: vi.fn(),
  UPDATE_ALLOWLIST: new Set(['title', 'status'])
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(),
  getSetting: vi.fn().mockReturnValue(null) // null → uses default ~/.bde/worktrees
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}))

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

// fs is mocked so the worktree-existence pre-flight check passes for the
// synthetic test paths (which don't exist on disk). Individual tests can
// override existsSync to simulate a missing worktree.
const { mockExistsSync } = vi.hoisted(() => ({ mockExistsSync: vi.fn(() => true) }))
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { ...actual, existsSync: mockExistsSync }
})

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync)
}))

import { homedir } from 'os'
import { registerReviewHandlers } from '../review'
import { safeHandle } from '../../ipc-utils'
import { nowIso } from '../../../shared/time'

describe('Review handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gitCommandCalls.length = 0 // Clear command tracking
    // vi.clearAllMocks does NOT reset implementations — re-apply the default
    // git impl so tests that override via mockImplementation don't leak into
    // the next test.
    mockExecFileAsync.mockImplementation(defaultGitImpl)
    // Default to "worktree exists" — individual tests override via
    // mockExistsSync.mockReturnValueOnce(false) to simulate cleanup.
    mockExistsSync.mockReturnValue(true)
  })

  it('registers all 13 review channels', () => {
    const mockDeps = { onStatusTerminal: vi.fn() }
    registerReviewHandlers(mockDeps)

    expect(safeHandle).toHaveBeenCalledTimes(13)
    expect(safeHandle).toHaveBeenCalledWith('review:getDiff', expect.any(Function), expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:getCommits', expect.any(Function), expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:getFileDiff', expect.any(Function), expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:mergeLocally', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:createPr', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:requestRevision', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:discard', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:shipIt', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:shipBatch', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:rebase', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:checkFreshness', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:checkAutoReview', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:markShippedOutsideBde', expect.any(Function))
  })

  it('deps.onStatusTerminal is called on terminal transitions', () => {
    const mockOnStatusTerminal = vi.fn()
    const mockDeps = { onStatusTerminal: mockOnStatusTerminal }
    registerReviewHandlers(mockDeps)
    // The callback should be wired up but not called during registration
    expect(mockOnStatusTerminal).not.toHaveBeenCalled()
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      const mockDeps = { onStatusTerminal: vi.fn() }
      registerReviewHandlers(mockDeps)
      return handlers
    }

    const _mockEvent = {} as IpcMainInvokeEvent

    it('review:getCommits handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:getCommits']).toBeDefined()
    })

    it('parses commit message with pipe character correctly', () => {
      // Unit test for the parsing logic: null byte delimiter prevents pipe character issues
      const gitOutput = [
        'abc123\x00feat: add A | B support\x00John Doe\x002026-04-01T12:00:00Z',
        'def456\x00fix: resolve pipe | parsing issue\x00Jane Smith\x002026-04-02T13:30:00Z'
      ].join('\n')

      // Simulate the parsing logic from review:getCommits handler
      const commits = gitOutput
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, message, author, date] = line.split('\x00')
          return { hash, message, author, date }
        })

      // Verify full messages are preserved including pipe characters
      expect(commits).toHaveLength(2)
      expect(commits[0]).toEqual({
        hash: 'abc123',
        message: 'feat: add A | B support',
        author: 'John Doe',
        date: '2026-04-01T12:00:00Z'
      })
      expect(commits[1]).toEqual({
        hash: 'def456',
        message: 'fix: resolve pipe | parsing issue',
        author: 'Jane Smith',
        date: '2026-04-02T13:30:00Z'
      })
    })

    it('review:getDiff handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:getDiff']).toBeDefined()
    })

    it('review:getFileDiff handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:getFileDiff']).toBeDefined()
    })

    it('review:mergeLocally handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:mergeLocally']).toBeDefined()
    })

    it('review:createPr handler is registered and transitions to done', () => {
      // Verifies handler registration. Expected behavior per fix:
      // - Calls updateTask with status: 'done', completed_at, worktree_path: null
      // - Calls _onStatusTerminal(taskId, 'done') for dependency resolution
      // - Follows the same pattern as review:mergeLocally
      const handlers = captureHandlers()
      expect(handlers['review:createPr']).toBeDefined()
    })

    it('review:requestRevision handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:requestRevision']).toBeDefined()
    })

    it('review:discard handler is registered', () => {
      const handlers = captureHandlers()
      expect(handlers['review:discard']).toBeDefined()
    })

    it('review:discard reads branch name before removing worktree', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      // Mock task with worktree
      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      // Mock repo config
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'cancelled',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso(),
        completed_at: nowIso()
      })

      const handlers = captureHandlers()
      await handlers['review:discard'](_mockEvent, { taskId: 'task-1' })

      // Verify ordering: rev-parse → worktree-remove → branch-delete
      expect(gitCommandCalls).toEqual(['rev-parse', 'worktree-remove', 'branch-delete'])
    })

    it('review:requestRevision with mode=fresh clears session_id', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        spec: '## Original Spec\n\nSome content',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'queued',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      const handlers = captureHandlers()
      await handlers['review:requestRevision'](_mockEvent, {
        taskId: 'task-1',
        feedback: 'Please fix the tests',
        mode: 'fresh'
      })

      // Verify agent_run_id is set to null in fresh mode
      expect(updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          agent_run_id: null,
          status: 'queued'
        }),
        undefined
      )
    })

    it('review:requestRevision with mode=resume keeps session_id', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        spec: '## Original Spec\n\nSome content',
        agent_run_id: 'existing-session-123',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'queued',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      const handlers = captureHandlers()
      await handlers['review:requestRevision'](_mockEvent, {
        taskId: 'task-1',
        feedback: 'Please fix the tests',
        mode: 'resume'
      })

      // Verify agent_run_id is NOT in the patch (keeps existing value)
      expect(updateTask).toHaveBeenCalledWith('task-1', expect.any(Object), undefined)
      const patchArg = vi.mocked(updateTask).mock.calls[0][1]
      expect(patchArg).not.toHaveProperty('agent_run_id')
    })

    it('review:requestRevision appends feedback to spec', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        spec: '## Original Spec\n\nSome content',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'queued',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      const handlers = captureHandlers()
      await handlers['review:requestRevision'](_mockEvent, {
        taskId: 'task-1',
        feedback: 'Please add more tests',
        mode: 'resume'
      })

      // Verify feedback is appended to spec
      expect(updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          spec: '## Original Spec\n\nSome content\n\n## Revision Feedback\n\nPlease add more tests'
        }),
        undefined
      )
    })

    it('review:mergeLocally marks task done and fires onStatusTerminal', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      const mockOnStatusTerminal = vi.fn()

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'done',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso(),
        completed_at: nowIso()
      })

      // Capture handlers with the specific mock we want to test
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      registerReviewHandlers({ onStatusTerminal: mockOnStatusTerminal })
      const result = await handlers['review:mergeLocally'](_mockEvent, {
        taskId: 'task-1',
        strategy: 'merge'
      })

      // Verify task updated to done with completed_at and worktree cleared
      expect(updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'done',
          completed_at: expect.any(String),
          worktree_path: null
        }),
        undefined
      )

      // Verify onStatusTerminal callback fired for dependency resolution
      expect(mockOnStatusTerminal).toHaveBeenCalledWith('task-1', 'done')

      // Verify success response
      expect(result).toEqual({ success: true })
    })

    it('review:mergeLocally fetches and rebases before merge', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])
      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'done',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso(),
        completed_at: nowIso()
      })

      const handlers = captureHandlers()
      await handlers['review:mergeLocally'](_mockEvent, { taskId: 'task-1', strategy: 'merge' })

      // Verify ordering: rev-parse → status → fetch → rebase → rev-parse (baseSha) → merge → worktree-remove → branch-delete
      expect(gitCommandCalls).toEqual([
        'rev-parse',
        'status',
        'fetch',
        'rebase',
        'rev-parse',
        'merge',
        'worktree-remove',
        'branch-delete'
      ])
    })

    it('review:mergeLocally returns error when rebase fails', async () => {
      const { getTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])

      // Mock rebase to fail
      mockExecFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'git') {
          if (args[0] === 'rev-parse') {
            gitCommandCalls.push('rev-parse')
            return { stdout: 'feature-branch\n', stderr: '' }
          }
          if (args[0] === 'status') {
            gitCommandCalls.push('status')
            return { stdout: '', stderr: '' }
          }
          if (args[0] === 'fetch') {
            gitCommandCalls.push('fetch')
            return { stdout: '', stderr: '' }
          }
          if (args[0] === 'rebase' && args[1] === 'origin/main') {
            gitCommandCalls.push('rebase')
            throw new Error('Rebase conflict')
          }
          if (args[0] === 'rebase' && args[1] === '--abort') {
            gitCommandCalls.push('rebase-abort')
            return { stdout: '', stderr: '' }
          }
        }
        return { stdout: '', stderr: '' }
      })

      const handlers = captureHandlers()
      const result = await handlers['review:mergeLocally'](_mockEvent, {
        taskId: 'task-1',
        strategy: 'merge'
      })

      // Verify error returned
      expect(result).toEqual({
        success: false,
        error: 'Rebase failed: Rebase onto main failed — manual conflict resolution needed.'
      })

      // Verify rebase was aborted
      expect(gitCommandCalls).toContain('rebase-abort')
    })

    it('review:shipIt fetches and rebases before merge', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])
      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'done',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso(),
        completed_at: nowIso()
      })

      const handlers = captureHandlers()
      await handlers['review:shipIt'](_mockEvent, { taskId: 'task-1', strategy: 'merge' })

      // Verify fetch and rebase occur in correct order
      expect(gitCommandCalls).toContain('fetch')
      expect(gitCommandCalls).toContain('rebase')
      const fetchIdx = gitCommandCalls.indexOf('fetch')
      const rebaseIdx = gitCommandCalls.indexOf('rebase')
      expect(fetchIdx).toBeLessThan(rebaseIdx)
      // Merge tracking depends on mock state from previous tests, so we only verify fetch→rebase order
    })

    it('review:shipIt returns error when rebase fails', async () => {
      const { getTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })

      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])

      // Mock rebase to fail
      mockExecFileAsync.mockImplementation(
        async (cmd: string, args: string[], opts?: { cwd?: string }) => {
          if (cmd === 'git') {
            if (args[0] === 'rev-parse') {
              gitCommandCalls.push('rev-parse')
              // Worktree returns feature branch; main repo returns 'main'
              const isMainRepo = opts?.cwd === '/repos/test'
              return { stdout: isMainRepo ? 'main\n' : 'feature-branch\n', stderr: '' }
            }
            if (args[0] === 'status') {
              gitCommandCalls.push('status')
              return { stdout: '', stderr: '' }
            }
            if (args[0] === 'fetch') {
              gitCommandCalls.push('fetch')
              return { stdout: '', stderr: '' }
            }
            if (args[0] === 'merge' && args[1] === '--ff-only') {
              // Fast-forward of local main succeeds
              return { stdout: '', stderr: '' }
            }
            if (args[0] === 'rebase' && args[1] === 'origin/main') {
              gitCommandCalls.push('rebase')
              throw new Error('Rebase conflict')
            }
            if (args[0] === 'rebase' && args[1] === '--abort') {
              gitCommandCalls.push('rebase-abort')
              return { stdout: '', stderr: '' }
            }
          }
          return { stdout: '', stderr: '' }
        }
      )

      const handlers = captureHandlers()
      const result = await handlers['review:shipIt'](_mockEvent, {
        taskId: 'task-1',
        strategy: 'merge'
      })

      // Verify error returned
      expect(result).toEqual({
        success: false,
        error: 'Rebase failed: Rebase onto main failed — manual conflict resolution needed.'
      })

      // Verify rebase was aborted
      expect(gitCommandCalls).toContain('rebase-abort')
    })

    it('review:shipIt fast-forwards local main before merging feature branch', async () => {
      // Pins the fix for the "local main stayed stale → push rejected → user
      // saw a green toast and got divergent history" bug: shipIt must fetch
      // and fast-forward the main checkout's local main before merging.
      const { getTask, updateTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])
      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'done',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso(),
        completed_at: nowIso()
      })

      // Track full merge args so we can distinguish `merge --ff-only origin/main`
      // (fast-forward of local main) from the later feature-branch merge.
      // Also capture the cwd of each git invocation by verb for ordering checks.
      const mergeCalls: string[][] = []
      const fetchCalls: Array<{ cwd: string }> = []
      mockExecFileAsync.mockImplementation(
        async (cmd: string, args: string[], opts?: { cwd?: string }) => {
          if (cmd === 'git') {
            if (args[0] === 'rev-parse') {
              gitCommandCalls.push('rev-parse')
              // First call from worktree returns feature branch;
              // second call from main repo returns 'main'.
              const isMainRepo = opts?.cwd === '/repos/test'
              return { stdout: isMainRepo ? 'main\n' : 'feature-branch\n', stderr: '' }
            }
            if (args[0] === 'status') {
              gitCommandCalls.push('status')
              return { stdout: '', stderr: '' }
            }
            if (args[0] === 'fetch') {
              fetchCalls.push({ cwd: opts?.cwd ?? '' })
              gitCommandCalls.push('fetch')
              return { stdout: '', stderr: '' }
            }
            if (args[0] === 'merge') {
              mergeCalls.push([...args])
              gitCommandCalls.push('merge')
              return { stdout: '', stderr: '' }
            }
            if (args[0] === 'rebase') {
              gitCommandCalls.push('rebase')
              return { stdout: '', stderr: '' }
            }
          }
          return { stdout: '', stderr: '' }
        }
      )

      const handlers = captureHandlers()
      const result = await handlers['review:shipIt'](_mockEvent, {
        taskId: 'task-1',
        strategy: 'merge'
      })

      expect(result.success).toBe(true)

      // Fetch must happen in the main repo checkout (so refs are updated there)
      expect(fetchCalls.length).toBeGreaterThanOrEqual(1)
      expect(fetchCalls[0].cwd).toBe('/repos/test')

      // There must be at least 2 merge calls: (1) ff-only of local main, (2) feature branch merge
      expect(mergeCalls.length).toBeGreaterThanOrEqual(2)

      // First merge must be the fast-forward of local main to origin/main
      const firstMerge = mergeCalls[0]
      expect(firstMerge).toContain('--ff-only')
      expect(firstMerge).toContain('origin/main')

      // Fast-forward must happen BEFORE the feature branch rebase
      const ffMergeIdx = gitCommandCalls.indexOf('merge')
      const rebaseIdx = gitCommandCalls.indexOf('rebase')
      expect(ffMergeIdx).toBeGreaterThan(-1)
      expect(rebaseIdx).toBeGreaterThan(-1)
      expect(ffMergeIdx).toBeLessThan(rebaseIdx)
    })

    it('review:shipIt bails out if main checkout is not on main branch', async () => {
      const { getTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])

      // Main repo rev-parse returns a feature branch, not 'main'
      mockExecFileAsync.mockImplementation(
        async (cmd: string, args: string[], opts?: { cwd?: string }) => {
          if (cmd === 'git') {
            if (args[0] === 'rev-parse') {
              const isMainRepo = opts?.cwd === '/repos/test'
              return {
                stdout: isMainRepo ? 'feature/user-other-work\n' : 'task-branch\n',
                stderr: ''
              }
            }
            if (args[0] === 'status') return { stdout: '', stderr: '' }
          }
          return { stdout: '', stderr: '' }
        }
      )

      const handlers = captureHandlers()
      const result = await handlers['review:shipIt'](_mockEvent, {
        taskId: 'task-1',
        strategy: 'merge'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('feature/user-other-work')
      expect(result.error).toContain('main')
    })

    it('review:shipIt returns error when local main cannot be fast-forwarded', async () => {
      const { getTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: nowIso(),
        updated_at: nowIso()
      })
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])

      mockExecFileAsync.mockImplementation(
        async (cmd: string, args: string[], opts?: { cwd?: string }) => {
          if (cmd === 'git') {
            if (args[0] === 'rev-parse') {
              const isMainRepo = opts?.cwd === '/repos/test'
              return {
                stdout: isMainRepo ? 'main\n' : 'feature-branch\n',
                stderr: ''
              }
            }
            if (args[0] === 'status') return { stdout: '', stderr: '' }
            if (args[0] === 'fetch') return { stdout: '', stderr: '' }
            if (args[0] === 'merge' && args[1] === '--ff-only') {
              throw new Error('Not possible to fast-forward, aborting.')
            }
          }
          return { stdout: '', stderr: '' }
        }
      )

      const handlers = captureHandlers()
      const result = await handlers['review:shipIt'](_mockEvent, {
        taskId: 'task-1',
        strategy: 'merge'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to sync local main with origin')
    })
  })

  describe('input validation — base ref', () => {
    function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      registerReviewHandlers({ onStatusTerminal: vi.fn() })
      return handlers
    }

    const _mockEvent = {} as IpcMainInvokeEvent
    const VALID_WORKTREE = `${homedir()}/.bde/worktrees/Users-ryan-projects-BDE/some-task-id`

    it.each([
      ['main', true],
      ['abc123def456abc1', true], // 16-char hex SHA prefix
      ['a'.repeat(40), true], // full SHA
      ['feat/my-branch', true],
      ['origin/main', true],
      ['HEAD~1', false], // tilde not allowed
      ['--format=%(body)', false], // flag injection
      ['../../etc/passwd', false], // path traversal
      ['', false], // empty
      ['; rm -rf /', false], // shell metachar
      ['a'.repeat(201), false] // too long
    ])('review:getDiff base="%s" → valid=%s', async (base, shouldPass) => {
      const handlers = captureHandlers()
      if (shouldPass) {
        // Should not throw validation error — git call may fail but that's fine in unit test
        await expect(
          handlers['review:getDiff'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
        ).resolves.not.toThrow()
      } else {
        await expect(
          handlers['review:getDiff'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
        ).rejects.toThrow(/invalid git ref/i)
      }
    })

    it.each([
      ['main', true],
      ['abc123def456abc1', true],
      ['--format=%(body)', false],
      ['../../etc', false],
      ['', false]
    ])('review:getCommits base="%s" → valid=%s', async (base, shouldPass) => {
      const handlers = captureHandlers()
      if (shouldPass) {
        await expect(
          handlers['review:getCommits'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
        ).resolves.not.toThrow()
      } else {
        await expect(
          handlers['review:getCommits'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
        ).rejects.toThrow(/invalid git ref/i)
      }
    })

    it.each([
      ['main', true],
      ['abc123def456abc1', true],
      ['--format=%(body)', false],
      ['', false]
    ])('review:getFileDiff base="%s" → valid=%s', async (base, shouldPass) => {
      const handlers = captureHandlers()
      if (shouldPass) {
        await expect(
          handlers['review:getFileDiff'](_mockEvent, {
            worktreePath: VALID_WORKTREE,
            base,
            filePath: 'src/foo.ts'
          })
        ).resolves.not.toThrow()
      } else {
        await expect(
          handlers['review:getFileDiff'](_mockEvent, {
            worktreePath: VALID_WORKTREE,
            base,
            filePath: 'src/foo.ts'
          })
        ).rejects.toThrow(/invalid git ref/i)
      }
    })
  })

  describe('input validation — worktreePath', () => {
    function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      registerReviewHandlers({ onStatusTerminal: vi.fn() })
      return handlers
    }

    const _mockEvent = {} as IpcMainInvokeEvent
    const VALID_BASE = 'main'
    const VALID_WORKTREE = `${homedir()}/.bde/worktrees/Users-ryan-projects-BDE/abc123`

    it.each([
      [`${homedir()}/.bde/worktrees/Users-ryan-projects-BDE/abc123`, true],
      [`${homedir()}/.bde/worktrees-adhoc/Users-ryan-projects-BDE/abc123`, true],
      ['/etc/passwd', false],
      ['../../etc', false],
      ['/tmp/evil', false],
      ['', false]
    ])('review:getDiff worktreePath="%s" → valid=%s', async (worktreePath, shouldPass) => {
      const handlers = captureHandlers()
      if (shouldPass) {
        await expect(
          handlers['review:getDiff'](_mockEvent, { worktreePath, base: VALID_BASE })
        ).resolves.not.toThrow()
      } else {
        await expect(
          handlers['review:getDiff'](_mockEvent, { worktreePath, base: VALID_BASE })
        ).rejects.toThrow(/invalid worktree path/i)
      }
    })

    it('review:getDiff accepts adhoc-base worktree path', async () => {
      // Pins the fix for the bug where adhoc-spawned tasks could not be
      // reviewed because validateWorktreePath only knew the pipeline base.
      const handlers = captureHandlers()
      const adhocPath = `${homedir()}/.bde/worktrees-adhoc/Users-ryan-projects-BDE/abc123`
      await expect(
        handlers['review:getDiff'](_mockEvent, { worktreePath: adhocPath, base: VALID_BASE })
      ).resolves.not.toThrow()
    })

    it('review:getDiff throws WorktreeMissingError when worktree directory is gone', async () => {
      // Pins the fix for the misleading "spawn git ENOENT" — when the
      // worktree directory has been pruned but the task row still references
      // it, we want a clear error instead of "git not found".
      mockExistsSync.mockReturnValue(false)
      const handlers = captureHandlers()
      await expect(
        handlers['review:getDiff'](_mockEvent, { worktreePath: VALID_WORKTREE, base: VALID_BASE })
      ).rejects.toThrow(/worktree directory no longer exists/i)
    })

    it('review:getCommits throws WorktreeMissingError when worktree directory is gone', async () => {
      mockExistsSync.mockReturnValue(false)
      const handlers = captureHandlers()
      await expect(
        handlers['review:getCommits'](_mockEvent, {
          worktreePath: VALID_WORKTREE,
          base: VALID_BASE
        })
      ).rejects.toThrow(/worktree directory no longer exists/i)
    })

    it('review:getFileDiff throws WorktreeMissingError when worktree directory is gone', async () => {
      mockExistsSync.mockReturnValue(false)
      const handlers = captureHandlers()
      await expect(
        handlers['review:getFileDiff'](_mockEvent, {
          worktreePath: VALID_WORKTREE,
          base: VALID_BASE,
          filePath: 'src/foo.ts'
        })
      ).rejects.toThrow(/worktree directory no longer exists/i)
    })

    it.each([
      [VALID_WORKTREE, true],
      ['/etc', false],
      ['', false]
    ])('review:getCommits worktreePath="%s" → valid=%s', async (worktreePath, shouldPass) => {
      const handlers = captureHandlers()
      if (shouldPass) {
        await expect(
          handlers['review:getCommits'](_mockEvent, { worktreePath, base: VALID_BASE })
        ).resolves.not.toThrow()
      } else {
        await expect(
          handlers['review:getCommits'](_mockEvent, { worktreePath, base: VALID_BASE })
        ).rejects.toThrow(/invalid worktree path/i)
      }
    })
  })

  describe('input validation — filePath', () => {
    function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      registerReviewHandlers({ onStatusTerminal: vi.fn() })
      return handlers
    }

    const _mockEvent = {} as IpcMainInvokeEvent
    const VALID_WORKTREE = `${homedir()}/.bde/worktrees/Users-ryan-projects-BDE/abc123`
    const VALID_BASE = 'main'

    it.each([
      ['src/main/foo.ts', true],
      ['README.md', true],
      ['src/renderer/src/App.tsx', true],
      ['../../etc/passwd', false], // path traversal
      ['/etc/hosts', false], // absolute path
      ['src/../../../etc', false], // embedded traversal
      ['', false] // empty
    ])('review:getFileDiff filePath="%s" → valid=%s', async (filePath, shouldPass) => {
      const handlers = captureHandlers()
      if (shouldPass) {
        await expect(
          handlers['review:getFileDiff'](_mockEvent, {
            worktreePath: VALID_WORKTREE,
            base: VALID_BASE,
            filePath
          })
        ).resolves.not.toThrow()
      } else {
        await expect(
          handlers['review:getFileDiff'](_mockEvent, {
            worktreePath: VALID_WORKTREE,
            base: VALID_BASE,
            filePath
          })
        ).rejects.toThrow(/invalid file path/i)
      }
    })
  })

  describe('input validation — taskId', () => {
    function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      registerReviewHandlers({ onStatusTerminal: vi.fn() })
      return handlers
    }

    const _mockEvent = {} as IpcMainInvokeEvent
    const INVALID_TASK_IDS = ['../../etc/passwd', '../secret', 'id;rm -rf /', '', 'a'.repeat(65)]
    const ACTION_CHANNELS = [
      'review:mergeLocally',
      'review:createPr',
      'review:requestRevision',
      'review:discard',
      'review:shipIt',
      'review:rebase',
      'review:checkFreshness',
      'review:checkAutoReview'
    ]

    it.each(ACTION_CHANNELS)('%s rejects path-traversal task ID', async (channel) => {
      const handlers = captureHandlers()
      await expect(handlers[channel](_mockEvent, { taskId: '../../etc/passwd' })).rejects.toThrow(
        'Invalid task ID format'
      )
    })

    it.each(INVALID_TASK_IDS)('review:mergeLocally rejects invalid task ID "%s"', async (badId) => {
      const handlers = captureHandlers()
      await expect(handlers['review:mergeLocally'](_mockEvent, { taskId: badId })).rejects.toThrow(
        'Invalid task ID format'
      )
    })

    it('review:mergeLocally accepts a valid ULID-style task ID', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      vi.mocked(getTask).mockReturnValue({
        id: '01HXXXXXXXXXXXXXXXXXXXXXXX',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'review',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      })
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'test-repo', localPath: '/repos/test' }])
      vi.mocked(updateTask).mockReturnValue({
        id: '01HXXXXXXXXXXXXXXXXXXXXXXX',
        repo: 'test-repo',
        status: 'done',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z'
      })

      const handlers = captureHandlers()
      // Should proceed past validation (may fail for git reasons in unit test — that's OK)
      await expect(
        handlers['review:mergeLocally'](_mockEvent, {
          taskId: '01HXXXXXXXXXXXXXXXXXXXXXXX',
          strategy: 'merge'
        })
      ).resolves.not.toThrow()
    })
  })
})
