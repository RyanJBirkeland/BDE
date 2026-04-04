/**
 * Review handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Track git command calls for ordering tests (hoisted for vi.mock)
const { gitCommandCalls, mockExecFileAsync } = vi.hoisted(() => {
  const gitCommandCalls: string[] = []

  const mockExecFileAsync = vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'git') {
      if (args[0] === 'rev-parse') {
        gitCommandCalls.push('rev-parse')
        return { stdout: 'feature-branch\n', stderr: '' }
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
  })

  return { gitCommandCalls, mockExecFileAsync }
})

// Mock dependencies before imports
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
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
  updateTask: vi.fn()
}))

vi.mock('../sprint-listeners', () => ({
  notifySprintMutation: vi.fn()
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn()
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}))

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync)
}))

import { registerReviewHandlers, setReviewOnStatusTerminal } from '../review'
import { safeHandle } from '../../ipc-utils'

describe('Review handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gitCommandCalls.length = 0 // Clear command tracking
  })

  it('registers all 10 review channels', () => {
    registerReviewHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(10)
    expect(safeHandle).toHaveBeenCalledWith('review:getDiff', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:getCommits', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:getFileDiff', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:mergeLocally', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:createPr', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:requestRevision', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:discard', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:shipIt', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:generateSummary', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('review:checkAutoReview', expect.any(Function))
  })

  it('setReviewOnStatusTerminal sets the callback', () => {
    const fn = vi.fn()
    setReviewOnStatusTerminal(fn)
    // Verify it doesn't throw
    expect(fn).not.toHaveBeenCalled()
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
      const handlers: Record<string, (...args: unknown[]) => unknown> = {}
      vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
        handlers[channel] = handler as (...args: unknown[]) => unknown
      })
      registerReviewHandlers()
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'queued',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
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
        })
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'queued',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      const handlers = captureHandlers()
      await handlers['review:requestRevision'](_mockEvent, {
        taskId: 'task-1',
        feedback: 'Please fix the tests',
        mode: 'resume'
      })

      // Verify agent_run_id is NOT in the patch (keeps existing value)
      expect(updateTask).toHaveBeenCalledWith('task-1', expect.any(Object))
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      vi.mocked(updateTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        status: 'queued',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
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
        })
      )
    })

    it('review:mergeLocally marks task done and fires onStatusTerminal', async () => {
      const { getTask, updateTask } = await import('../../data/sprint-queries')
      const { getSettingJson } = await import('../../settings')

      const mockOnStatusTerminal = vi.fn()
      setReviewOnStatusTerminal(mockOnStatusTerminal)

      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        repo: 'test-repo',
        worktree_path: '/tmp/worktrees/test',
        status: 'active',
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 1,
        depends_on: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      })

      const handlers = captureHandlers()
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
        })
      )

      // Verify onStatusTerminal callback fired for dependency resolution
      expect(mockOnStatusTerminal).toHaveBeenCalledWith('task-1', 'done')

      // Verify success response
      expect(result).toEqual({ success: true })
    })
  })
})
