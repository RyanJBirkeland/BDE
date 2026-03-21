import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentHandle, AgentEvent } from '../../agents/types'
import { AgentManager } from '../../agent-manager/agent-manager'
import type { AgentManagerDeps, QueuedTask } from '../../agent-manager/agent-manager'

// --- Helpers ---

function makeTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
  return {
    id: 'task-1',
    title: 'Fix login bug',
    repo: 'bde',
    prompt: 'Fix the login bug in auth.ts',
    priority: 1,
    status: 'queued',
    retry_count: 0,
    fast_fail_count: 0,
    ...overrides,
  }
}

/** Create a mock AgentHandle with a controllable async event stream. */
function createMockHandle(
  id = 'handle-1',
): AgentHandle & {
  _pushEvent: (event: AgentEvent) => void
  _complete: () => void
} {
  const queue: AgentEvent[] = []
  let resolve: (() => void) | null = null
  let done = false

  async function* eventGenerator() {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!
      } else if (done) {
        return
      } else {
        await new Promise<void>((r) => {
          resolve = r
        })
      }
    }
  }

  return {
    id,
    pid: 1234,
    events: eventGenerator(),
    steer: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    _pushEvent: (event: AgentEvent) => {
      queue.push(event)
      resolve?.()
      resolve = null
    },
    _complete: () => {
      done = true
      resolve?.()
      resolve = null
    },
  }
}

function makeDefaultConfig() {
  return {
    maxConcurrent: 2,
    worktreeBase: '/tmp/worktrees',
    maxRuntimeMs: 60_000,
    idleMs: 30_000,
    drainIntervalMs: 1_000,
  }
}

function makeDeps(overrides: Partial<AgentManagerDeps> = {}): AgentManagerDeps {
  return {
    getQueuedTasks: vi.fn().mockResolvedValue([]),
    updateTask: vi.fn().mockResolvedValue(undefined),
    ensureAuth: vi.fn().mockResolvedValue(undefined),
    spawnAgent: vi.fn().mockResolvedValue(createMockHandle()),
    createWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: '/tmp/worktrees/task-1', branch: 'agent/task-1' }),
    handleCompletion: vi.fn().mockResolvedValue(undefined),
    emitEvent: vi.fn(),
    getRepoInfo: vi.fn().mockReturnValue({ repoPath: '/repos/bde', ghRepo: 'org/bde' }),
    config: makeDefaultConfig(),
    ...overrides,
  }
}

describe('AgentManager integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Full pipeline ──────────────────────────────────────────────────

  describe('full pipeline: queued task -> completion', () => {
    it('picks up a queued task, spawns agent, flows events, calls completion handler', async () => {
      const handle = createMockHandle('pipeline-handle')
      const task = makeTask()
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
      })

      const manager = new AgentManager(deps)
      manager.start()

      // Trigger the drain loop
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      // Verify auth was called
      expect(deps.ensureAuth).toHaveBeenCalled()

      // Verify repo lookup
      expect(deps.getRepoInfo).toHaveBeenCalledWith('bde')

      // Verify task marked active
      expect(deps.updateTask).toHaveBeenCalledWith('task-1', {
        status: 'active',
        started_at: expect.any(String),
      })

      // Verify worktree created
      expect(deps.createWorktree).toHaveBeenCalledWith('/repos/bde', 'task-1', '/tmp/worktrees')

      // Verify agent spawned with correct prompt
      expect(deps.spawnAgent).toHaveBeenCalledWith({
        prompt: 'Fix the login bug in auth.ts',
        cwd: '/tmp/worktrees/task-1',
      })

      // Verify agent is now active
      expect(manager.activeCount).toBe(1)
      expect(manager.availableSlots).toBe(1)

      // Push events through the stream
      handle._pushEvent({ type: 'agent:text', text: 'Working...', timestamp: Date.now() })
      handle._pushEvent({
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0.05,
        tokensIn: 1000,
        tokensOut: 500,
        durationMs: 45_000,
        timestamp: Date.now(),
      })

      // Wait for event consumption to finish
      await vi.waitFor(() => {
        expect(deps.handleCompletion).toHaveBeenCalledWith({
          taskId: 'task-1',
          agentId: 'pipeline-handle',
          repoPath: '/repos/bde',
          worktreePath: '/tmp/worktrees/task-1',
          ghRepo: 'org/bde',
          exitCode: 0,
          worktreeBase: '/tmp/worktrees',
          retryCount: 0,
          fastFailCount: 0,
          durationMs: 45_000,
        })
      })

      // Verify events were emitted
      expect(deps.emitEvent).toHaveBeenCalledWith('pipeline-handle', expect.objectContaining({ type: 'agent:text' }))

      // After completion, agent should be removed from active
      expect(manager.activeCount).toBe(0)

      manager.stop()
    })

    it('builds prompt from spec + prompt when both are present', async () => {
      const handle = createMockHandle()
      const task = makeTask({ spec: '## Spec\nDo the thing', prompt: '## Instructions\nDetails here' })
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      expect(deps.spawnAgent).toHaveBeenCalledWith({
        prompt: '## Spec\nDo the thing\n\n## Instructions\nDetails here',
        cwd: '/tmp/worktrees/task-1',
      })

      handle._pushEvent({
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 1000,
        timestamp: Date.now(),
      })
      await vi.waitFor(() => expect(deps.handleCompletion).toHaveBeenCalled())
      manager.stop()
    })

    it('falls back to title when no spec or prompt', async () => {
      const handle = createMockHandle()
      const task = makeTask({ prompt: null, spec: null })
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      expect(deps.spawnAgent).toHaveBeenCalledWith({
        prompt: 'Fix login bug',
        cwd: '/tmp/worktrees/task-1',
      })

      handle._pushEvent({
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 1000,
        timestamp: Date.now(),
      })
      await vi.waitFor(() => expect(deps.handleCompletion).toHaveBeenCalled())
      manager.stop()
    })
  })

  // ── Repo not found ─────────────────────────────────────────────────

  describe('repo not found', () => {
    it('marks task as error when repo is not found in settings', async () => {
      const task = makeTask({ repo: 'unknown-repo' })
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        getRepoInfo: vi.fn().mockReturnValue(null),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      await vi.waitFor(() => {
        expect(deps.updateTask).toHaveBeenCalledWith('task-1', {
          status: 'error',
          error: 'Repository not found in settings: unknown-repo',
        })
      })

      expect(deps.spawnAgent).not.toHaveBeenCalled()
      manager.stop()
    })
  })

  // ── Concurrency ────────────────────────────────────────────────────

  describe('concurrency control', () => {
    it('respects maxConcurrent — only 2 of 3 queued tasks spawn initially', async () => {
      const handles = [createMockHandle('h1'), createMockHandle('h2'), createMockHandle('h3')]
      let spawnIndex = 0

      const tasks = [
        makeTask({ id: 'task-1', title: 'Task 1' }),
        makeTask({ id: 'task-2', title: 'Task 2' }),
        makeTask({ id: 'task-3', title: 'Task 3' }),
      ]

      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce(tasks).mockResolvedValue([tasks[2]]),
        spawnAgent: vi.fn().mockImplementation(() => {
          const handle = handles[spawnIndex++]
          return Promise.resolve(handle)
        }),
        createWorktree: vi.fn().mockImplementation((_rp, taskId) =>
          Promise.resolve({ worktreePath: `/tmp/worktrees/${taskId}`, branch: `agent/${taskId}` }),
        ),
        config: { ...makeDefaultConfig(), maxConcurrent: 2 },
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      // Only 2 should have spawned (limited by maxConcurrent)
      expect(deps.spawnAgent).toHaveBeenCalledTimes(2)
      expect(manager.activeCount).toBe(2)
      expect(manager.availableSlots).toBe(0)

      // Complete first agent — opens a slot
      handles[0]._pushEvent({
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 5000,
        timestamp: Date.now(),
      })

      await vi.waitFor(() => expect(manager.activeCount).toBe(1))

      // Next drain picks up the third task
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      await vi.waitFor(() => expect(deps.spawnAgent).toHaveBeenCalledTimes(3))

      // Cleanup
      handles[1]._pushEvent({
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 5000,
        timestamp: Date.now(),
      })
      handles[2]._pushEvent({
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 5000,
        timestamp: Date.now(),
      })
      await vi.waitFor(() => expect(manager.activeCount).toBe(0))
      manager.stop()
    })
  })

  // ── Drain loop re-entrancy guard ───────────────────────────────────

  describe('drain loop re-entrancy', () => {
    it('does not start a second drain while one is already running', async () => {
      let resolveGetTasks: (tasks: QueuedTask[]) => void
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockImplementation(
          () => new Promise<QueuedTask[]>((r) => { resolveGetTasks = r }),
        ),
      })

      const manager = new AgentManager(deps)
      manager.start()

      // First drain starts
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)
      expect(deps.getQueuedTasks).toHaveBeenCalledTimes(1)

      // Second drain interval fires while first is still pending
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)
      // Should still only have 1 call since first drain hasn't finished
      expect(deps.getQueuedTasks).toHaveBeenCalledTimes(1)

      // Resolve first drain
      resolveGetTasks!([])
      await vi.advanceTimersByTimeAsync(0) // flush microtasks

      // Now next drain should succeed
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)
      expect(deps.getQueuedTasks).toHaveBeenCalledTimes(2)

      manager.stop()
    })
  })

  // ── Failure → completion handler receives non-zero exit ────────────

  describe('agent failure', () => {
    it('passes non-zero exitCode and durationMs to completion handler', async () => {
      const handle = createMockHandle('fail-handle')
      const task = makeTask({ retry_count: 1, fast_fail_count: 0 })
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      handle._pushEvent({
        type: 'agent:completed',
        exitCode: 1,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 50_000,
        timestamp: Date.now(),
      })

      await vi.waitFor(() => {
        expect(deps.handleCompletion).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'task-1',
            exitCode: 1,
            durationMs: 50_000,
            retryCount: 1,
            fastFailCount: 0,
          }),
        )
      })

      manager.stop()
    })
  })

  // ── Fast-fail flow ─────────────────────────────────────────────────

  describe('fast-fail passthrough', () => {
    it('passes fast_fail_count from task to completion handler', async () => {
      const handle = createMockHandle('ff-handle')
      const task = makeTask({ fast_fail_count: 2 })
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      // Agent exits quickly (< 30s) with non-zero code
      handle._pushEvent({
        type: 'agent:completed',
        exitCode: 1,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 5_000,
        timestamp: Date.now(),
      })

      await vi.waitFor(() => {
        expect(deps.handleCompletion).toHaveBeenCalledWith(
          expect.objectContaining({
            fastFailCount: 2,
            durationMs: 5_000,
          }),
        )
      })

      manager.stop()
    })
  })

  // ── Watchdog integration ───────────────────────────────────────────

  describe('watchdog integration', () => {
    it('kills agent when max runtime is exceeded', async () => {
      const handle = createMockHandle('wd-handle')
      const task = makeTask()
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
        config: { ...makeDefaultConfig(), maxRuntimeMs: 10_000, idleMs: 5_000 },
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      expect(manager.activeCount).toBe(1)

      // Advance past max runtime
      await vi.advanceTimersByTimeAsync(10_000)

      // The watchdog should have called handle.stop()
      expect(handle.stop).toHaveBeenCalled()

      manager.stop()
    })

    it('kills agent when idle timeout is exceeded (no events)', async () => {
      const handle = createMockHandle('wd-idle-handle')
      const task = makeTask()
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
        config: { ...makeDefaultConfig(), maxRuntimeMs: 60_000, idleMs: 5_000 },
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      // Advance past idle timeout (no events arrive to ping watchdog)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(handle.stop).toHaveBeenCalled()

      manager.stop()
    })
  })

  // ── Auth failure ───────────────────────────────────────────────────

  describe('auth failure prevents agent spawning', () => {
    it('marks task as error when ensureAuth throws', async () => {
      const task = makeTask()
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        ensureAuth: vi.fn().mockRejectedValue(new Error('Token expired')),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      await vi.waitFor(() => {
        expect(deps.updateTask).toHaveBeenCalledWith('task-1', {
          status: 'error',
          error: 'Token expired',
        })
      })

      expect(deps.spawnAgent).not.toHaveBeenCalled()
      manager.stop()
    })
  })

  // ── Kill agent ─────────────────────────────────────────────────────

  describe('killAgent', () => {
    it('kills an active agent and removes it from tracking', async () => {
      const handle = createMockHandle('kill-handle')
      const task = makeTask()
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      expect(manager.activeCount).toBe(1)

      const killed = manager.killAgent('task-1')
      expect(killed).toBe(true)
      expect(handle.stop).toHaveBeenCalled()
      expect(manager.activeCount).toBe(0)

      manager.stop()
    })

    it('returns false for unknown taskId', () => {
      const deps = makeDeps()
      const manager = new AgentManager(deps)
      expect(manager.killAgent('nonexistent')).toBe(false)
    })
  })

  // ── Stop cleans up everything ──────────────────────────────────────

  describe('stop', () => {
    it('stops all active agents and clears drain interval', async () => {
      const handle = createMockHandle('stop-handle')
      const task = makeTask()
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(handle),
      })

      const manager = new AgentManager(deps)
      manager.start()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      expect(manager.activeCount).toBe(1)

      manager.stop()

      expect(handle.stop).toHaveBeenCalled()
      expect(manager.activeCount).toBe(0)

      // Drain should not fire anymore
      vi.mocked(deps.getQueuedTasks).mockClear()
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs * 5)
      expect(deps.getQueuedTasks).not.toHaveBeenCalled()
    })
  })

  // ── Stream error ───────────────────────────────────────────────────

  describe('stream error', () => {
    it('calls completion handler with exitCode 1 when event stream throws', async () => {
      const errorEvents: AsyncIterable<AgentEvent> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error('stream broke'))
            },
            return() {
              return Promise.resolve({ done: true as const, value: undefined })
            },
            throw() {
              return Promise.resolve({ done: true as const, value: undefined })
            },
          }
        },
      }

      const errorHandle: AgentHandle = {
        id: 'err-handle',
        pid: 9999,
        events: errorEvents,
        steer: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      }

      const task = makeTask()
      const deps = makeDeps({
        getQueuedTasks: vi.fn().mockResolvedValueOnce([task]).mockResolvedValue([]),
        spawnAgent: vi.fn().mockResolvedValue(errorHandle),
      })

      const manager = new AgentManager(deps)
      manager.start()

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

      await vi.waitFor(() => {
        expect(deps.handleCompletion).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'task-1',
            exitCode: 1,
          }),
        )
      })

      consoleSpy.mockRestore()
      manager.stop()
    })
  })
})
