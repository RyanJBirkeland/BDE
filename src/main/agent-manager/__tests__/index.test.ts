import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('../../data/sprint-queries', () => ({
  getQueuedTasks: vi.fn(),
  claimTask: vi.fn(),
  updateTask: vi.fn(),
  getTask: vi.fn(),
  getOrphanedTasks: vi.fn(),
}))

vi.mock('../../auth-guard', () => ({
  checkAuthStatus: vi.fn(),
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn(),
}))

vi.mock('../sdk-adapter', () => ({
  spawnAgent: vi.fn(),
}))

vi.mock('../worktree', () => ({
  setupWorktree: vi.fn(),
  cleanupWorktree: vi.fn(),
  pruneStaleWorktrees: vi.fn(),
  branchNameForTask: vi.fn(),
}))

vi.mock('../completion', () => ({
  resolveSuccess: vi.fn(),
  resolveFailure: vi.fn(),
}))

vi.mock('../orphan-recovery', () => ({
  recoverOrphans: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createAgentManager } from '../index'
import type { AgentManagerConfig, AgentHandle } from '../types'
import { getQueuedTasks, claimTask, updateTask } from '../../data/sprint-queries'
import { checkAuthStatus } from '../../auth-guard'
import { getRepoPaths } from '../../paths'
import { spawnAgent } from '../sdk-adapter'
import { setupWorktree, pruneStaleWorktrees } from '../worktree'
import { recoverOrphans } from '../orphan-recovery'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees/bde',
  maxRuntimeMs: 60 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
  pollIntervalMs: 600_000,
  defaultModel: 'claude-sonnet-4-5',
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1', title: 'Test task', repo: 'myrepo', prompt: 'Do the thing',
    spec: null, priority: 1, status: 'queued' as const, notes: null,
    retry_count: 0, fast_fail_count: 0, agent_run_id: null,
    pr_number: null, pr_status: null, pr_url: null, claimed_by: null,
    started_at: null, completed_at: null, template_name: null,
    updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setupDefaultMocks(): void {
  vi.mocked(checkAuthStatus).mockResolvedValue({ cliFound: true, tokenFound: true, tokenExpired: false })
  vi.mocked(getRepoPaths).mockReturnValue({ myrepo: '/repos/myrepo' })
  vi.mocked(getQueuedTasks).mockResolvedValue([])
  vi.mocked(claimTask).mockResolvedValue(null)
  vi.mocked(updateTask).mockResolvedValue(null)
  vi.mocked(recoverOrphans).mockResolvedValue(0)
  vi.mocked(pruneStaleWorktrees).mockResolvedValue(0)
  vi.mocked(setupWorktree).mockResolvedValue({ worktreePath: '/tmp/wt/myrepo/task-1', branch: 'agent/test-task' })
}

function makeMockHandle(messages: unknown[] = []) {
  const abortFn = vi.fn()
  const steerFn = vi.fn().mockResolvedValue(undefined)
  async function* gen(): AsyncIterable<unknown> { for (const m of messages) yield m }
  return {
    handle: { messages: gen(), sessionId: 'mock-session', abort: abortFn, steer: steerFn } as AgentHandle,
    abortFn, steerFn,
  }
}

function makeBlockingHandle() {
  let resolveMessages: (() => void) | undefined
  const p = new Promise<void>((r) => { resolveMessages = r })
  const abortFn = vi.fn(() => { resolveMessages?.() })
  async function* gen(): AsyncIterable<unknown> { await p }
  return {
    handle: { messages: gen(), sessionId: 'blocking', abort: abortFn, steer: vi.fn().mockResolvedValue(undefined) } as AgentHandle,
    abortFn, resolve: () => resolveMessages?.(),
  }
}

async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

// ---------------------------------------------------------------------------
// Tests — each test creates a fresh manager, logger, and mock overrides.
// Because some tests spawn blocking agents that survive stop(0), we clear
// mock call counts after mgr.start()+flush() when testing specific behaviors.
// ---------------------------------------------------------------------------

describe('createAgentManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setupDefaultMocks()
  })

  describe('start()', () => {
    it('sets running = true and runs orphan recovery + prune', async () => {
      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, logger)

      mgr.start()

      expect(mgr.getStatus().running).toBe(true)
      expect(mgr.getStatus().shuttingDown).toBe(false)
      expect(vi.mocked(recoverOrphans)).toHaveBeenCalled()
      expect(vi.mocked(pruneStaleWorktrees)).toHaveBeenCalled()

      await mgr.stop(100)
      await flush()
    })

    it('runs initial drain immediately (calls checkAuthStatus + getQueuedTasks)', async () => {
      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, logger)

      mgr.start()
      await flush()

      expect(vi.mocked(checkAuthStatus)).toHaveBeenCalled()
      expect(vi.mocked(getQueuedTasks)).toHaveBeenCalled()

      await mgr.stop(100)
      await flush()
    })
  })

  describe('drain loop', () => {
    it('claims task, spawns agent, registers in active map', async () => {
      const logger = makeLogger()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      await flush()

      expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith({
        prompt: 'Do the thing',
        cwd: '/tmp/wt/myrepo/task-1',
        model: 'claude-sonnet-4-5',
      })
      expect(vi.mocked(claimTask)).toHaveBeenCalledWith('task-1', 'bde-embedded')

      await mgr.stop(500)
      await flush()
    })

    it('skips drain when auth expired', async () => {
      // Override auth to fail
      vi.mocked(checkAuthStatus).mockResolvedValue({
        cliFound: true, tokenFound: true, tokenExpired: true, expiresAt: new Date(Date.now() - 1000),
      })

      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      await flush()

      // The manager's own drain should have logged the warning
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Auth token missing or expired'),
      )

      await mgr.stop(100)
      await flush()
    })

    it('skips drain when no token found', async () => {
      vi.mocked(checkAuthStatus).mockResolvedValue({
        cliFound: true, tokenFound: false, tokenExpired: false,
      })

      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      await flush()

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Auth token missing or expired'),
      )

      await mgr.stop(100)
      await flush()
    })

    it('skips task when repo path not found', async () => {
      const task = makeTask({ id: 'task-nomatch', repo: 'unknown-repo' })
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])

      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      await flush()

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No repo path'),
      )

      await mgr.stop(100)
      await flush()
    })

    it('marks task error when setupWorktree fails', async () => {
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(setupWorktree).mockRejectedValueOnce(new Error('git worktree failed'))

      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      await flush()

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith('task-1', {
        status: 'error',
        completed_at: expect.any(String),
      })

      await mgr.stop(100)
      await flush()
    })

    it('respects concurrency limit', async () => {
      const config = { ...baseConfig, maxConcurrent: 1 }
      const task = makeTask()
      const { handle } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const logger = makeLogger()
      const mgr = createAgentManager(config, logger)
      mgr.start()
      await flush()

      const status = mgr.getStatus()
      expect(status.activeAgents.length).toBe(1)
      expect(status.concurrency.activeCount).toBe(1)
      expect(status.concurrency.effectiveSlots).toBe(1)

      await mgr.stop(100)
      await flush()
    })
  })

  describe('stop()', () => {
    it('aborts active agents and sets running = false', async () => {
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      await flush()

      expect(mgr.getStatus().activeAgents.length).toBe(1)

      await mgr.stop(5_000)
      await flush()

      expect(abortFn).toHaveBeenCalled()
      expect(mgr.getStatus().running).toBe(false)
    })
  })

  describe('getStatus()', () => {
    it('returns correct initial state before start', () => {
      const mgr = createAgentManager(baseConfig, makeLogger())
      const status = mgr.getStatus()

      expect(status.running).toBe(false)
      expect(status.shuttingDown).toBe(false)
      expect(status.concurrency.maxSlots).toBe(2)
      expect(status.activeAgents).toEqual([])
    })

    it('reflects running state after start', async () => {
      const mgr = createAgentManager(baseConfig, makeLogger())
      mgr.start()

      expect(mgr.getStatus().running).toBe(true)

      await mgr.stop(100)
      await flush()
    })
  })

  describe('watchdog', () => {
    it('kills idle agent after timeout', async () => {
      vi.useFakeTimers()

      const config: AgentManagerConfig = { ...baseConfig, idleTimeoutMs: 50, pollIntervalMs: 999_999 }
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const logger = makeLogger()
      const mgr = createAgentManager(config, logger)
      mgr.start()

      // Flush async drain — advance timers by 1ms multiple times to let promises resolve
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(mgr.getStatus().activeAgents.length).toBe(1)

      // Advance past idle timeout (50ms) + watchdog check interval (10_000ms)
      await vi.advanceTimersByTimeAsync(10_100)

      expect(abortFn).toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Watchdog killing task task-1: idle'),
      )

      // Cleanup
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })
  })

  describe('steerAgent', () => {
    it('throws when no active agent', async () => {
      const mgr = createAgentManager(baseConfig, makeLogger())
      await expect(mgr.steerAgent('nonexistent', 'hello')).rejects.toThrow(
        'No active agent for task nonexistent',
      )
    })

    it('delegates to handle.steer()', async () => {
      const task = makeTask()
      const { handle } = makeBlockingHandle()
      const steerFn = handle.steer as ReturnType<typeof vi.fn>

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, makeLogger())
      mgr.start()
      await flush()

      await mgr.steerAgent('task-1', 'focus on tests')
      expect(steerFn).toHaveBeenCalledWith('focus on tests')

      await mgr.stop(100)
      await flush()
    })
  })

  describe('killAgent', () => {
    it('throws when no active agent', () => {
      const mgr = createAgentManager(baseConfig, makeLogger())
      expect(() => mgr.killAgent('nonexistent')).toThrow(
        'No active agent for task nonexistent',
      )
    })

    it('calls handle.abort()', async () => {
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, makeLogger())
      mgr.start()
      await flush()

      mgr.killAgent('task-1')
      expect(abortFn).toHaveBeenCalled()

      await mgr.stop(100)
      await flush()
    })
  })
})
