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
  getTasksWithDependencies: vi.fn().mockResolvedValue([]),
}))

vi.mock('../dependency-index', () => ({
  createDependencyIndex: vi.fn(() => ({
    rebuild: vi.fn(),
    getDependents: vi.fn(() => new Set()),
    areDependenciesSatisfied: vi.fn(() => ({ satisfied: true, blockedBy: [] })),
  })),
}))

vi.mock('../resolve-dependents', () => ({
  resolveDependents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn(),
  getGhRepo: vi.fn(),
  BDE_AGENT_LOG_PATH: '/tmp/bde-agent-test.log',
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
    depends_on: null,
    updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setupDefaultMocks(): void {
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

    it('runs initial drain after defer period', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const mgr = createAgentManager(baseConfig, logger)

      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(getQueuedTasks)).toHaveBeenCalled()

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })
  })

  describe('drain loop', () => {
    it('claims task, spawns agent, registers in active map', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'Do the thing', cwd: '/tmp/wt/myrepo/task-1', model: 'claude-sonnet-4-5' })
      )
      expect(vi.mocked(claimTask)).toHaveBeenCalledWith('task-1', 'bde-embedded')

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('persists agent_run_id to sprint task after successful spawn', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ agent_run_id: expect.any(String) }),
      )

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('marks task as error when spawnAgent rejects with auth error', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('Authentication failed'))

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith('task-1', expect.objectContaining({
        status: 'error',
      }))

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('skips drain when no concurrency slots available', async () => {
      vi.useFakeTimers()
      const config = { ...baseConfig, maxConcurrent: 1 }
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      const { handle } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(config, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      // Slot is full — now reset mock and trigger another poll
      vi.mocked(getQueuedTasks).mockClear()
      // Advance poll interval to trigger second drain
      await vi.advanceTimersByTimeAsync(600_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      // getQueuedTasks should NOT be called when concurrency is saturated
      expect(vi.mocked(getQueuedTasks)).not.toHaveBeenCalled()

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('skips task when repo path not found', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask({ id: 'task-nomatch', repo: 'unknown-repo' })
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No repo path'),
      )

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('marks task error when setupWorktree fails', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(setupWorktree).mockRejectedValueOnce(new Error('git worktree failed'))

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith('task-1', {
        status: 'error',
        completed_at: expect.any(String),
      })

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('logs error when fetchQueuedTasks rejects', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(getQueuedTasks).mockRejectedValueOnce(new Error('Supabase down'))
      const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 50 }, logger)
      mgr.start()
      // Advance past INITIAL_DRAIN_DEFER_MS (5000ms); use small steps to let promises resolve
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Drain loop error'))
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('logs error when spawnAgent rejects', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(getQueuedTasks).mockResolvedValueOnce([makeTask()])
      vi.mocked(claimTask).mockResolvedValueOnce({ id: 'test-task' } as any)
      vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('SDK crash'))
      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      // Advance past INITIAL_DRAIN_DEFER_MS (5000ms); use small steps to let promises resolve
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('spawnAgent failed'))
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('respects concurrency limit', async () => {
      vi.useFakeTimers()
      const config = { ...baseConfig, maxConcurrent: 1 }
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      const { handle } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(config, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      const status = mgr.getStatus()
      expect(status.activeAgents.length).toBe(1)
      expect(status.concurrency.activeCount).toBe(1)
      expect(status.concurrency.effectiveSlots).toBe(1)

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })
  })

  describe('stop()', () => {
    it('aborts active agents and sets running = false', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(mgr.getStatus().activeAgents.length).toBe(1)

      mgr.stop(0).catch(() => {})
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(abortFn).toHaveBeenCalled()
      expect(mgr.getStatus().running).toBe(false)

      vi.useRealTimers()
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

      // Advance past INITIAL_DRAIN_DEFER_MS (5000ms) to spawn agent
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
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
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      const { handle } = makeBlockingHandle()
      const steerFn = handle.steer as ReturnType<typeof vi.fn>

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

      await mgr.steerAgent('task-1', 'focus on tests')
      expect(steerFn).toHaveBeenCalledWith('focus on tests')

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
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
      vi.useFakeTimers()
      setupDefaultMocks()
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
      vi.mocked(claimTask).mockResolvedValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, makeLogger())
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

      mgr.killAgent('task-1')
      expect(abortFn).toHaveBeenCalled()

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })
  })
})
