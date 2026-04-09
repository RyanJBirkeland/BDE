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
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  setSprintQueriesLogger: vi.fn()
}))

vi.mock('../dependency-index', () => ({
  createDependencyIndex: vi.fn(() => ({
    rebuild: vi.fn(),
    getDependents: vi.fn(() => new Set()),
    areDependenciesSatisfied: vi.fn(() => ({ satisfied: true, blockedBy: [] }))
  }))
}))

vi.mock('../resolve-dependents', () => ({
  resolveDependents: vi.fn().mockReturnValue(undefined)
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn(),
  getGhRepo: vi.fn(),
  BDE_AGENT_LOG_PATH: '/tmp/bde-agent-test.log',
  BDE_TASK_MEMORY_DIR: '/tmp/bde-test/tasks'
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }),
  }
})

vi.mock('../sdk-adapter', () => ({
  spawnAgent: vi.fn()
}))

vi.mock('../worktree', () => ({
  setupWorktree: vi.fn(),
  cleanupWorktree: vi.fn(),
  pruneStaleWorktrees: vi.fn(),
  branchNameForTask: vi.fn()
}))

vi.mock('../completion', () => ({
  resolveSuccess: vi.fn(),
  resolveFailure: vi.fn()
}))

vi.mock('../orphan-recovery', () => ({
  recoverOrphans: vi.fn()
}))

vi.mock('../../agent-history', () => ({
  createAgentRecord: vi.fn().mockResolvedValue({}),
  updateAgentMeta: vi.fn().mockResolvedValue(undefined)
}))

// Mock node:fs/promises so checkOAuthToken reads a valid token on CI
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('test-oauth-token-valid-for-ci-mock'),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() - 60_000 })
  }
})

vi.mock('../../agent-system/memory/user-memory', () => ({
  getUserMemory: vi.fn(() => ({ content: '', totalBytes: 0, fileCount: 0 }))
}))

// Mock env-utils refresh functions used by checkOAuthToken
vi.mock('../../env-utils', () => ({
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false),
  invalidateOAuthToken: vi.fn(),
  getOAuthToken: vi.fn().mockReturnValue('test-oauth-token'),
  buildAgentEnv: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
  buildAgentEnvWithAuth: vi
    .fn()
    .mockReturnValue({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'test-token' })
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createAgentManager } from '../index'
import type { AgentManagerConfig, AgentHandle } from '../types'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'
import { createAgentRecord } from '../../agent-history'
import {
  getQueuedTasks,
  claimTask,
  updateTask,
  getTask,
  getOrphanedTasks,
  getTasksWithDependencies
} from '../../data/sprint-queries'
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
  defaultModel: 'claude-sonnet-4-5'
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Test task',
    repo: 'myrepo',
    prompt: 'Do the thing',
    spec: null,
    priority: 1,
    status: 'queued' as const,
    notes: null,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    template_name: null,
    depends_on: null,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

function setupDefaultMocks(): void {
  vi.mocked(getRepoPaths).mockReturnValue({ myrepo: '/repos/myrepo' })
  vi.mocked(getQueuedTasks).mockReturnValue([])
  vi.mocked(claimTask).mockReturnValue(null)
  vi.mocked(updateTask).mockReturnValue(null)
  vi.mocked(recoverOrphans).mockResolvedValue(0)
  vi.mocked(pruneStaleWorktrees).mockResolvedValue(0)
  vi.mocked(setupWorktree).mockResolvedValue({
    worktreePath: '/tmp/wt/myrepo/task-1',
    branch: 'agent/test-task'
  })
}

function makeMockRepo(): ISprintTaskRepository {
  return {
    getTask: (...args: [string]) => (getTask as any)(...args),
    updateTask: (...args: [string, Record<string, unknown>]) => (updateTask as any)(...args),
    getQueuedTasks: (...args: [number]) => (getQueuedTasks as any)(...args),
    getTasksWithDependencies: () => (getTasksWithDependencies as any)(),
    getOrphanedTasks: (...args: [string]) => (getOrphanedTasks as any)(...args),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    claimTask: (...args: [string, string]) => (claimTask as any)(...args)
  }
}

const mockRepo = makeMockRepo()

function makeMockHandle(messages: unknown[] = []) {
  const abortFn = vi.fn()
  const steerFn = vi.fn().mockResolvedValue({ delivered: true })
  async function* gen(): AsyncIterable<unknown> {
    for (const m of messages) yield m
  }
  return {
    handle: {
      messages: gen(),
      sessionId: 'mock-session',
      abort: abortFn,
      steer: steerFn
    } as AgentHandle,
    abortFn,
    steerFn
  }
}

function makeBlockingHandle() {
  let resolveMessages: (() => void) | undefined
  const p = new Promise<void>((r) => {
    resolveMessages = r
  })
  const abortFn = vi.fn(() => {
    resolveMessages?.()
  })
  async function* gen(): AsyncIterable<unknown> {
    await p
  }
  return {
    handle: {
      messages: gen(),
      sessionId: 'blocking',
      abort: abortFn,
      steer: vi.fn().mockResolvedValue({ delivered: true })
    } as AgentHandle,
    abortFn,
    resolve: () => resolveMessages?.()
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

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start()', () => {
    it('sets running = true and runs orphan recovery + prune', async () => {
      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, mockRepo, logger)

      mgr.start()

      expect(mgr.getStatus().running).toBe(true)
      expect(mgr.getStatus().shuttingDown).toBe(false)
      expect(vi.mocked(recoverOrphans)).toHaveBeenCalled()
      expect(vi.mocked(pruneStaleWorktrees)).toHaveBeenCalled()

      await mgr.stop(100)
      await flush()
    })

    it('is idempotent — calling start() twice does not create duplicate loops', async () => {
      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, mockRepo, logger)

      mgr.start()

      // Record call counts after first start
      const orphanCalls = vi.mocked(recoverOrphans).mock.calls.length
      const pruneCalls = vi.mocked(pruneStaleWorktrees).mock.calls.length

      mgr.start() // second call should be a no-op

      expect(mgr.getStatus().running).toBe(true)

      // No additional calls should have been made
      expect(vi.mocked(recoverOrphans)).toHaveBeenCalledTimes(orphanCalls)
      expect(vi.mocked(pruneStaleWorktrees)).toHaveBeenCalledTimes(pruneCalls)

      await mgr.stop(100)
      await flush()
    })

    it('runs initial drain after defer period', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const mgr = createAgentManager(baseConfig, mockRepo, logger)

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
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Do the thing'),
          cwd: '/tmp/wt/myrepo/task-1',
          model: 'claude-sonnet-4-5'
        })
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
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ agent_run_id: expect.any(String) })
      )

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('calls createAgentRecord when spawning an agent', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
      vi.mocked(createAgentRecord).mockResolvedValue({} as any)

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(createAgentRecord)).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          task: expect.any(String),
          repo: expect.any(String),
          status: 'running',
          sprintTaskId: 'task-1',
          source: 'bde'
        })
      )

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('re-queues task when spawnAgent rejects with auth error', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('Authentication failed'))

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'queued'
        })
      )

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('logs error when fetchQueuedTasks rejects', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(getQueuedTasks).mockImplementationOnce(() => {
        throw new Error('Supabase down')
      })
      const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 50 }, mockRepo, logger)
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
      vi.mocked(getQueuedTasks).mockReturnValueOnce([makeTask()])
      vi.mocked(claimTask).mockReturnValueOnce({ id: 'test-task' } as any)
      vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('SDK crash'))
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      // Advance past INITIAL_DRAIN_DEFER_MS (5000ms); use small steps to let promises resolve
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('spawnAgent failed'))
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

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(config, mockRepo, logger)
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
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No repo path'))

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('marks task error when setupWorktree fails', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(setupWorktree).mockRejectedValueOnce(new Error('git worktree failed'))

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith('task-1', {
        status: 'error',
        completed_at: expect.any(String),
        notes: expect.stringContaining('Worktree setup failed:'),
        claimed_by: null
      })

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('logs error when fetchQueuedTasks rejects', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(getQueuedTasks).mockImplementationOnce(() => {
        throw new Error('Supabase down')
      })
      const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 50 }, mockRepo, logger)
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
      vi.mocked(getQueuedTasks).mockReturnValueOnce([makeTask()])
      vi.mocked(claimTask).mockReturnValueOnce({ id: 'test-task' } as any)
      vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('SDK crash'))
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
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

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(config, mockRepo, logger)
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

    it('re-checks available slots inside drain for-loop (defense-in-depth)', async () => {
      // The drain loop re-checks availableSlots(concurrency, activeAgents.size)
      // before each processQueuedTask call. This guards against over-spawning
      // when activeAgents grows between fetchQueuedTasks and iteration.
      //
      // With the current fire-and-forget _runAgent pattern, activeAgents.set
      // happens in a microtask that may not resolve between for-loop iterations
      // under fake timers. So we test the guard by filling the slot from a
      // PRIOR drain, then triggering a second drain where available=0 at the
      // top-level check prevents even entering the for-loop.
      //
      // The in-loop re-check provides additional safety for edge cases where
      // activeAgents.size changes between the top-level check and iteration
      // (e.g., concurrent agent registration, backpressure changes).
      vi.useFakeTimers()
      const config = { ...baseConfig, maxConcurrent: 1, pollIntervalMs: 600_000 }
      const logger = makeLogger()
      setupDefaultMocks()

      // First drain: fill the slot
      const task1 = makeTask({ id: 'task-1' })
      const { handle } = makeBlockingHandle()
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task1])
      vi.mocked(claimTask).mockReturnValueOnce(task1)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(config, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1)

      expect(mgr.getStatus().activeAgents.length).toBe(1)

      // Second drain: slot full, should not process any new tasks
      const task2 = makeTask({ id: 'task-2' })
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task2])
      vi.mocked(claimTask).mockClear()

      await vi.advanceTimersByTimeAsync(config.pollIntervalMs + 1_000)
      for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1)

      // No new claims — both the top-level check and the in-loop re-check
      // would prevent processing task-2
      expect(vi.mocked(claimTask)).not.toHaveBeenCalled()
      expect(mgr.getStatus().activeAgents.length).toBe(1)

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

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
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

    it('re-queues active tasks after shutdown', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      const { handle } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
      vi.mocked(updateTask).mockClear()

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(mgr.getStatus().activeAgents.length).toBe(1)

      mgr.stop(0).catch(() => {})
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'queued',
          claimed_by: null,
          started_at: null,
          notes: 'Task was re-queued due to BDE shutdown while agent was running.'
        })
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Re-queued task task-1 during shutdown')
      )

      vi.useRealTimers()
    })
  })

  describe('getStatus()', () => {
    it('returns correct initial state before start', () => {
      const mgr = createAgentManager(baseConfig, mockRepo, makeLogger())
      const status = mgr.getStatus()

      expect(status.running).toBe(false)
      expect(status.shuttingDown).toBe(false)
      expect(status.concurrency.maxSlots).toBe(2)
      expect(status.activeAgents).toEqual([])
    })

    it('reflects running state after start', async () => {
      const mgr = createAgentManager(baseConfig, mockRepo, makeLogger())
      mgr.start()

      expect(mgr.getStatus().running).toBe(true)

      await mgr.stop(100)
      await flush()
    })
  })

  describe('watchdog', () => {
    it('aborts agent and marks task error when maxRuntimeMs exceeded', async () => {
      vi.useFakeTimers()

      const config: AgentManagerConfig = {
        ...baseConfig,
        maxRuntimeMs: 60_000, // 1 minute
        pollIntervalMs: 999_999
      }
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const logger = makeLogger()
      const mgr = createAgentManager(config, mockRepo, logger)
      mgr.start()

      // Advance past INITIAL_DRAIN_DEFER_MS (5000ms) to spawn agent
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(mgr.getStatus().activeAgents.length).toBe(1)

      // Advance past watchdog check interval (10_000ms) + maxRuntimeMs (60_000ms)
      await vi.advanceTimersByTimeAsync(70_100)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(abortFn).toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Watchdog killing task task-1: max-runtime')
      )
      expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'error',
          notes:
            'Agent exceeded the maximum runtime of 1 minutes. The task may be too large for a single agent session. Consider breaking it into smaller subtasks.'
        })
      )

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    // NOTE: rate-limit-loop watchdog verdict is tested at the unit level in
    // watchdog.test.ts (checkAgent returns 'rate-limit-loop') and the backpressure
    // behavior in concurrency.test.ts. Integration-level testing with real timers
    // requires >15s (INITIAL_DRAIN_DEFER_MS + WATCHDOG_INTERVAL_MS) which exceeds
    // the test timeout, and fake timers cannot flush async generator microtasks.

    it('kills idle agent after timeout', async () => {
      vi.useFakeTimers()

      const config: AgentManagerConfig = {
        ...baseConfig,
        idleTimeoutMs: 50,
        pollIntervalMs: 999_999
      }
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const logger = makeLogger()
      const mgr = createAgentManager(config, mockRepo, logger)
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
        expect.stringContaining('Watchdog killing task task-1: idle')
      )

      // Cleanup
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('logs warning when updateTask rejects after max-runtime kill', async () => {
      vi.useFakeTimers()
      const config: AgentManagerConfig = {
        ...baseConfig,
        maxRuntimeMs: 100,
        pollIntervalMs: 999_999
      }
      const task = makeTask()
      const { handle } = makeBlockingHandle()
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
      // Make ALL updateTask calls reject — the watchdog one is not the first call
      vi.mocked(updateTask).mockImplementation(() => {
        throw new Error('DB error')
      })
      const logger = makeLogger()
      const mgr = createAgentManager(config, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(10_100)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update task task-1 after max-runtime kill')
      )
      vi.mocked(updateTask).mockReturnValue(null) // reset
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('logs warning when updateTask rejects after idle kill', async () => {
      vi.useFakeTimers()
      const config: AgentManagerConfig = {
        ...baseConfig,
        idleTimeoutMs: 50,
        pollIntervalMs: 999_999
      }
      const task = makeTask()
      const { handle } = makeBlockingHandle()
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
      vi.mocked(updateTask).mockImplementation(() => {
        throw new Error('DB error')
      })
      const logger = makeLogger()
      const mgr = createAgentManager(config, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(10_100)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update task task-1 after idle kill')
      )
      vi.mocked(updateTask).mockReturnValue(null)
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    // NOTE: rate-limit requeue error test removed — same timing constraint as above.
  })

  describe('steerAgent', () => {
    it('returns { delivered: false } when no active agent', async () => {
      const mgr = createAgentManager(baseConfig, mockRepo, makeLogger())
      const result = await mgr.steerAgent('nonexistent', 'hello')
      expect(result).toEqual({ delivered: false, error: 'Agent not found' })
    })

    it('delegates to handle.steer() and returns result', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      const { handle } = makeBlockingHandle()
      const steerFn = handle.steer as ReturnType<typeof vi.fn>
      steerFn.mockResolvedValue({ delivered: true })

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

      const result = await mgr.steerAgent('task-1', 'focus on tests')
      expect(steerFn).toHaveBeenCalledWith('focus on tests')
      expect(result).toEqual({ delivered: true })

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('returns failure result when handle.steer fails', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      const { handle } = makeBlockingHandle()
      const steerFn = handle.steer as ReturnType<typeof vi.fn>
      steerFn.mockResolvedValue({ delivered: false, error: 'stdin closed' })

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

      const result = await mgr.steerAgent('task-1', 'test')
      expect(result).toEqual({ delivered: false, error: 'stdin closed' })

      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })
  })

  describe('killAgent', () => {
    it('returns killed=false when no active agent', () => {
      const mgr = createAgentManager(baseConfig, mockRepo, makeLogger())
      const result = mgr.killAgent('nonexistent')
      expect(result).toEqual({ killed: false, error: 'No active agent for task nonexistent' })
    })

    it('calls handle.abort()', async () => {
      vi.useFakeTimers()
      setupDefaultMocks()
      const task = makeTask()
      const { handle, abortFn } = makeBlockingHandle()

      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

      const mgr = createAgentManager(baseConfig, mockRepo, makeLogger())
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

  describe('stop() — abort error and drainInFlight paths', () => {
    it('handles abort() throwing during stop without crashing (line 402)', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      const task = makeTask()
      let resolveMessages: (() => void) | undefined
      const p = new Promise<void>((r) => {
        resolveMessages = r
      })
      const abortFn = vi.fn(() => {
        resolveMessages?.()
        throw new Error('Abort failed')
      })
      async function* gen(): AsyncIterable<unknown> {
        await p
      }
      const handle = {
        messages: gen(),
        sessionId: 's',
        abort: abortFn,
        steer: vi.fn().mockResolvedValue(undefined)
      } as AgentHandle
      vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
      vi.mocked(claimTask).mockReturnValueOnce(task)
      vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      expect(mgr.getStatus().activeAgents.length).toBe(1)
      const stopPromise = mgr.stop(100)
      await vi.advanceTimersByTimeAsync(200)
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
      await stopPromise.catch(() => {})
      expect(abortFn).toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to abort agent task-1 during shutdown')
      )
      vi.useRealTimers()
    })

    it('waits for in-flight drain before stopping (lines 395-396)', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      let resolveDrain: (() => void) | undefined
      const drainDelay = new Promise<void>((r) => {
        resolveDrain = r
      })
      vi.mocked(getQueuedTasks).mockImplementation(async () => {
        await drainDelay
        return []
      })
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      const stopPromise = mgr.stop(5000)
      resolveDrain?.()
      await vi.advanceTimersByTimeAsync(100)
      for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(5100)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await stopPromise
      expect(mgr.getStatus().running).toBe(false)
      vi.useRealTimers()
    })
  })

  describe('onTaskTerminal', () => {
    it('resolves dependents via resolveDependents', async () => {
      const { resolveDependents } = await import('../resolve-dependents')
      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      await mgr.onTaskTerminal('task-1', 'done')
      expect(vi.mocked(resolveDependents)).toHaveBeenCalledWith(
        'task-1',
        'done',
        expect.anything(),
        expect.anything(),
        expect.anything(),
        logger
      )
    })

    it('logs error when resolveDependents throws', async () => {
      const { resolveDependents } = await import('../resolve-dependents')
      vi.mocked(resolveDependents).mockImplementationOnce(() => {
        throw new Error('dep error')
      })
      const logger = makeLogger()
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      await mgr.onTaskTerminal('task-1', 'done')
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('resolveDependents failed for task-1')
      )
    })
  })

  describe('start() error handlers', () => {
    it('logs error when initial orphan recovery fails', async () => {
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(recoverOrphans).mockRejectedValueOnce(new Error('orphan error'))
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      await flush(20)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Initial orphan recovery error')
      )
      await mgr.stop(100)
      await flush()
    })

    it('logs error when initial worktree prune fails', async () => {
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(pruneStaleWorktrees).mockRejectedValueOnce(new Error('prune error'))
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      await flush(20)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Initial worktree prune error')
      )
      await mgr.stop(100)
      await flush()
    })

    it('logs error when initial dependency index build fails', async () => {
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(getTasksWithDependencies).mockImplementationOnce(() => {
        throw new Error('dep index error')
      })
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      await flush(20)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to build dependency index')
      )
      await mgr.stop(100)
      await flush()
    })
  })

  describe('periodic loops — error handling', () => {
    it('logs error from orphanLoop when recoverOrphans rejects during periodic interval', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(recoverOrphans)
        .mockResolvedValueOnce(0)
        .mockRejectedValueOnce(new Error('orphan periodic error'))
      const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 999_999 }, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(61_000)
      for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Orphan recovery before initial drain error')
      )
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('logs error from pruneLoop when pruneStaleWorktrees rejects during periodic interval', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(pruneStaleWorktrees)
        .mockResolvedValueOnce(0)
        .mockRejectedValueOnce(new Error('prune periodic error'))
      const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 999_999 }, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(301_000)
      for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Worktree prune error'))
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('invokes isActive callback via pruneStaleWorktrees', async () => {
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(pruneStaleWorktrees).mockImplementation(async (_base, isActiveFn) => {
        if (typeof isActiveFn === 'function') isActiveFn('some-task-id')
        return 0
      })
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      await flush(20)
      expect(vi.mocked(pruneStaleWorktrees)).toHaveBeenCalled()
      await mgr.stop(100)
      await flush()
    })
  })

  describe('drain loop — dependency checking', () => {
    it('builds taskStatusMap from getTasksWithDependencies (covers map callback fn 15)', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      // Return tasks with data so the .map() callback fires
      vi.mocked(getTasksWithDependencies).mockResolvedValue([
        { id: 'dep-1', status: 'done', depends_on: null } as any,
        { id: 'dep-2', status: 'queued', depends_on: null } as any
      ])
      vi.mocked(getQueuedTasks).mockReturnValueOnce([])
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      expect(vi.mocked(getTasksWithDependencies)).toHaveBeenCalled()
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('auto-blocks task with unsatisfied dependencies (covers dep callback fn 16)', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      // Return tasks for dep index
      vi.mocked(getTasksWithDependencies).mockResolvedValue([
        { id: 'blocker-1', status: 'active', depends_on: null } as any,
        {
          id: 'task-dep',
          status: 'queued',
          depends_on: JSON.stringify([{ taskId: 'blocker-1', type: 'hard' }])
        } as any
      ])
      // Return a task with depends_on
      const taskWithDeps = makeTask({
        id: 'task-dep',
        depends_on: JSON.stringify([{ taskId: 'blocker-1', type: 'hard' }]),
        dependsOn: JSON.stringify([{ taskId: 'blocker-1', type: 'hard' }])
      })
      vi.mocked(getQueuedTasks).mockReturnValueOnce([taskWithDeps])

      // Mock depIndex.areDependenciesSatisfied to invoke the getStatus callback AND return unsatisfied
      const { createDependencyIndex } = await import('../dependency-index')
      vi.mocked(createDependencyIndex).mockReturnValue({
        rebuild: vi.fn(),
        getDependents: vi.fn(() => new Set()),
        areDependenciesSatisfied: vi.fn((_taskId, _deps, getStatus) => {
          // Invoke the callback to cover fn 16 (line 220)
          if (typeof getStatus === 'function') getStatus('blocker-1')
          return { satisfied: false, blockedBy: ['blocker-1'] }
        })
      } as any)

      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('unsatisfied deps'))
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })

    it('skips task when claimTask returns null', async () => {
      vi.useFakeTimers()
      const logger = makeLogger()
      setupDefaultMocks()
      vi.mocked(getQueuedTasks).mockReturnValueOnce([makeTask()])
      vi.mocked(claimTask).mockReturnValueOnce(null)
      const mgr = createAgentManager(baseConfig, mockRepo, logger)
      mgr.start()
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(6_000)
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('already claimed'))
      mgr.stop(0).catch(() => {})
      vi.useRealTimers()
    })
  })

  describe('defaultLogger / fileLog coverage', () => {
    it('uses defaultLogger when no custom logger is passed, covering info path', async () => {
      setupDefaultMocks()
      const mgr = createAgentManager(baseConfig, mockRepo)
      mgr.start()
      await flush(20)
      expect(mgr.getStatus().running).toBe(true)
      await mgr.stop(100)
      await flush()
    })

    it('triggers defaultLogger.warn and .error paths when operations fail', async () => {
      setupDefaultMocks()
      // Make initial orphan recovery reject to trigger error logging
      vi.mocked(recoverOrphans).mockRejectedValueOnce(new Error('test orphan error'))
      // Make initial prune reject to trigger error logging
      vi.mocked(pruneStaleWorktrees).mockRejectedValueOnce(new Error('test prune error'))
      const mgr = createAgentManager(baseConfig, mockRepo)
      mgr.start()
      await flush(30)
      // Both error handlers should have fired via defaultLogger.error
      await mgr.stop(100)
      await flush()
    })
  })
})
