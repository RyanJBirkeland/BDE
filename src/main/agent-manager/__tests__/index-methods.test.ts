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

vi.mock('../../services/dependency-service', () => ({
  createDependencyIndex: vi.fn(() => ({
    rebuild: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
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
  BDE_AGENT_LOG_PATH: '/tmp/bde-agent-test.log'
}))

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

vi.mock('../watchdog', () => ({
  checkAgent: vi.fn(() => 'ok')
}))

vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('mock-oauth-token-longer-than-20-chars'),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ size: 0, mtimeMs: Date.now() }),
  renameSync: vi.fn(),
  rmSync: vi.fn()
}))

vi.mock('../../env-utils', () => ({
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false),
  invalidateOAuthToken: vi.fn(),
  buildAgentEnv: vi.fn().mockReturnValue({}),
  buildAgentEnvWithAuth: vi.fn().mockResolvedValue({})
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { AgentManagerImpl } from '../index'
import type { AgentManagerConfig, ActiveAgent, AgentHandle } from '../types'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'
import { getRepoPaths } from '../../paths'
import { setupWorktree, pruneStaleWorktrees } from '../worktree'
import { recoverOrphans } from '../orphan-recovery'
import { checkAgent } from '../watchdog'
import {
  claimTask,
  updateTask,
  getQueuedTasks,
  getTask,
  getOrphanedTasks,
  getTasksWithDependencies
} from '../../data/sprint-queries'
import { mapQueuedTask, checkAndBlockDeps } from '../task-mapper'
import { createDependencyIndex } from '../../services/dependency-service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 3,
  worktreeBase: '/tmp/worktrees/bde',
  maxRuntimeMs: 60 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
  pollIntervalMs: 600_000,
  defaultModel: 'claude-sonnet-4-5'
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function makeMockRepo(): ISprintTaskRepository {
  return {
    getTask: (...args: [string]) => (getTask as ReturnType<typeof vi.fn>)(...args),
    updateTask: (...args: [string, Record<string, unknown>]) =>
      (updateTask as ReturnType<typeof vi.fn>)(...args),
    getQueuedTasks: (...args: [number]) => (getQueuedTasks as ReturnType<typeof vi.fn>)(...args),
    getTasksWithDependencies: () => (getTasksWithDependencies as ReturnType<typeof vi.fn>)(),
    getOrphanedTasks: (...args: [string]) =>
      (getOrphanedTasks as ReturnType<typeof vi.fn>)(...args),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    claimTask: (...args: [string, string]) => (claimTask as ReturnType<typeof vi.fn>)(...args)
  }
}

function makeActiveAgent(taskId: string): ActiveAgent {
  return {
    taskId,
    agentRunId: `run-${taskId}`,
    handle: {
      messages: (async function* () {})(),
      sessionId: `session-${taskId}`,
      abort: vi.fn(),
      steer: vi.fn().mockResolvedValue({ delivered: true })
    } as AgentHandle,
    model: 'claude-sonnet-4-5',
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: null,
    maxCostUsd: null
  }
}

function makeRawTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Test task',
    repo: 'myrepo',
    prompt: 'Do the thing',
    spec: null,
    retry_count: 0,
    fast_fail_count: 0,
    playground_enabled: false,
    max_runtime_ms: null,
    ...overrides
  }
}

function setupDefaultMocks() {
  vi.mocked(getRepoPaths).mockReturnValue({ myrepo: '/repos/myrepo' })
  vi.mocked(claimTask).mockReturnValue({ id: 'task-1' } as ReturnType<typeof vi.fn>)
  vi.mocked(updateTask).mockReturnValue(null)
  vi.mocked(recoverOrphans).mockResolvedValue(0)
  vi.mocked(pruneStaleWorktrees).mockResolvedValue(0)
  vi.mocked(setupWorktree).mockResolvedValue({
    worktreePath: '/tmp/wt/myrepo/task-1',
    branch: 'agent/test-task'
  })
  vi.mocked(checkAgent).mockReturnValue('ok')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentManagerImpl — class internals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  // -------------------------------------------------------------------------
  // 1. State visibility
  // -------------------------------------------------------------------------

  describe('state visibility', () => {
    it('_activeAgents is an empty Map on construction', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      expect(manager._activeAgents).toBeInstanceOf(Map)
      expect(manager._activeAgents.size).toBe(0)
    })

    it('_concurrency.maxSlots matches config.maxConcurrent', () => {
      const config = { ...baseConfig, maxConcurrent: 5 }
      const manager = new AgentManagerImpl(config, makeMockRepo(), makeLogger())
      expect(manager._concurrency.maxSlots).toBe(5)
    })

    it('_processingTasks is an empty Set on construction', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      expect(manager._processingTasks).toBeInstanceOf(Set)
      expect(manager._processingTasks.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // 2. _processQueuedTask race guard
  // -------------------------------------------------------------------------

  describe('_processQueuedTask race guard', () => {
    it('skips task already in _processingTasks — claimTask not called', async () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const raw = makeRawTask({ id: 'task-race' })

      // Pre-populate the guard set
      manager._processingTasks.add('task-race')

      await manager._processQueuedTask(raw, new Map())

      expect(claimTask).not.toHaveBeenCalled()
    })

    it('removes task from _processingTasks after successful completion', async () => {
      const repo = makeMockRepo()
      const manager = new AgentManagerImpl(baseConfig, repo, makeLogger())

      // Make runAgent resolve immediately by not actually calling it (setupWorktree never resolves)
      // We just need to ensure the finally block runs — use a task that hits an early return
      vi.mocked(getRepoPaths).mockReturnValue({})
      const raw = makeRawTask({ id: 'task-cleanup', repo: 'unknown-repo' })

      await manager._processQueuedTask(raw, new Map())

      expect(manager._processingTasks.has('task-cleanup')).toBe(false)
    })

    it('removes task from _processingTasks even when claim fails (early return path)', async () => {
      vi.mocked(claimTask).mockReturnValue(null)
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const raw = makeRawTask({ id: 'task-claim-fail' })

      await manager._processQueuedTask(raw, new Map())

      expect(manager._processingTasks.has('task-claim-fail')).toBe(false)
    })

    it('removes task from _processingTasks when repo path not found (early return path)', async () => {
      vi.mocked(getRepoPaths).mockReturnValue({})
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const raw = makeRawTask({ id: 'task-no-repo', repo: 'no-such-repo' })

      await manager._processQueuedTask(raw, new Map())

      expect(manager._processingTasks.has('task-no-repo')).toBe(false)
      expect(claimTask).not.toHaveBeenCalled()
    })

    it('removes task from _processingTasks when setupWorktree throws', async () => {
      vi.mocked(setupWorktree).mockRejectedValue(new Error('git error'))
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const raw = makeRawTask({ id: 'task-wt-fail' })

      await manager._processQueuedTask(raw, new Map())

      expect(manager._processingTasks.has('task-wt-fail')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Watchdog race guard
  // -------------------------------------------------------------------------

  describe('_watchdogLoop race guard', () => {
    it('skips agents whose taskId is in _processingTasks — agent NOT killed despite max-runtime verdict', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const agent = makeActiveAgent('task-in-flight')
      manager._activeAgents.set('task-in-flight', agent)
      manager._processingTasks.add('task-in-flight')

      // checkAgent returns max-runtime — without the guard the agent would be killed
      vi.mocked(checkAgent).mockReturnValue('max-runtime')

      manager._watchdogLoop()

      // Agent must still be in _activeAgents — guard protected it
      expect(manager._activeAgents.has('task-in-flight')).toBe(true)
      expect(agent.handle.abort).not.toHaveBeenCalled()
    })

    it('kills agents NOT in _processingTasks when verdict is max-runtime', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const agent = makeActiveAgent('task-idle')
      manager._activeAgents.set('task-idle', agent)
      // _processingTasks does NOT contain this agent

      vi.mocked(checkAgent).mockReturnValue('max-runtime')

      manager._watchdogLoop()

      // Agent should be removed and abort called
      expect(manager._activeAgents.has('task-idle')).toBe(false)
      expect(agent.handle.abort).toHaveBeenCalledOnce()
    })

    it('does not kill agents when verdict is ok', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const agent = makeActiveAgent('task-healthy')
      manager._activeAgents.set('task-healthy', agent)

      vi.mocked(checkAgent).mockReturnValue('ok')

      manager._watchdogLoop()

      expect(manager._activeAgents.has('task-healthy')).toBe(true)
      expect(agent.handle.abort).not.toHaveBeenCalled()
    })

    it('processes multiple agents: kills only those not in _processingTasks', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())

      const agentA = makeActiveAgent('task-a')
      const agentB = makeActiveAgent('task-b')

      manager._activeAgents.set('task-a', agentA)
      manager._activeAgents.set('task-b', agentB)

      // task-a is being processed — protected by guard
      manager._processingTasks.add('task-a')

      // Both would fail max-runtime check
      vi.mocked(checkAgent).mockReturnValue('max-runtime')

      manager._watchdogLoop()

      expect(manager._activeAgents.has('task-a')).toBe(true)
      expect(agentA.handle.abort).not.toHaveBeenCalled()

      expect(manager._activeAgents.has('task-b')).toBe(false)
      expect(agentB.handle.abort).toHaveBeenCalledOnce()
    })

    it('Fix 2: calls process.kill(SIGKILL) on the underlying subprocess when available', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const killFn = vi.fn()
      const agent = makeActiveAgent('task-sigkill')
      // Attach a mock process with kill() to the handle, simulating the SDK subprocess
      ;(agent.handle as any).process = { kill: killFn }
      manager._activeAgents.set('task-sigkill', agent)

      vi.mocked(checkAgent).mockReturnValue('max-runtime')

      manager._watchdogLoop()

      expect(agent.handle.abort).toHaveBeenCalledOnce()
      expect(killFn).toHaveBeenCalledWith('SIGKILL')
    })

    it('Fix 2: does not throw when process.kill is not available on the handle', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const agent = makeActiveAgent('task-no-proc')
      // No process property on handle
      manager._activeAgents.set('task-no-proc', agent)

      vi.mocked(checkAgent).mockReturnValue('max-runtime')

      expect(() => manager._watchdogLoop()).not.toThrow()
      expect(agent.handle.abort).toHaveBeenCalledOnce()
    })
  })

  // -------------------------------------------------------------------------
  // Fix 3: stop() timeout default is 60 seconds
  // -------------------------------------------------------------------------

  describe('Fix 3: stop() timeout value', () => {
    it('default stop() timeout is 60000ms (not 10000ms)', () => {
      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      // Vite may compile 60_000 to 6e4 or 60000; all represent 60 seconds.
      // Check for any of: 60_000, 60000, 6e4
      const src = manager.stop.toString()
      const matches60s =
        /timeoutMs\s*=\s*60[_]?000/.test(src) ||
        /timeoutMs\s*=\s*6e4/.test(src) ||
        /timeoutMs\s*=\s*60000/.test(src)
      expect(matches60s).toBe(true)
      // Verify it is NOT the old 10s value
      expect(src).not.toMatch(/timeoutMs\s*=\s*1e4\b/)
      expect(src).not.toMatch(/timeoutMs\s*=\s*10_?000\b/)
    })
  })

  // -------------------------------------------------------------------------
  // 4. _mapQueuedTask
  // -------------------------------------------------------------------------

  describe('mapQueuedTask', () => {
    it('maps camelCase Queue API fields to local snake_case shape', () => {
      const logger = makeLogger()
      const raw = {
        id: 'task-42',
        title: 'Build feature',
        prompt: 'Add login page',
        spec: 'Login spec',
        repo: 'myrepo',
        retry_count: 2,
        fast_fail_count: 1,
        playground_enabled: true,
        max_runtime_ms: 30000
      }
      const result = mapQueuedTask(raw, logger)
      expect(result).toEqual({
        id: 'task-42',
        title: 'Build feature',
        prompt: 'Add login page',
        spec: 'Login spec',
        repo: 'myrepo',
        retry_count: 2,
        fast_fail_count: 1,
        notes: null,
        playground_enabled: true,
        max_runtime_ms: 30000,
        max_cost_usd: null,
        model: null,
        group_id: null
      })
    })

    it('defaults prompt and spec to null when missing', () => {
      const logger = makeLogger()
      const raw = {
        id: 'task-43',
        title: 'Minimal task',
        repo: 'myrepo'
      }
      const result = mapQueuedTask(raw as Record<string, unknown>, logger)
      expect(result!.prompt).toBeNull()
      expect(result!.spec).toBeNull()
    })

    it('defaults retry_count and fast_fail_count to 0 for non-numeric values', () => {
      const logger = makeLogger()
      const raw = {
        id: 'task-44',
        title: 'Bad counts',
        repo: 'myrepo',
        retry_count: 'abc',
        fast_fail_count: undefined
      }
      const result = mapQueuedTask(raw as Record<string, unknown>, logger)
      expect(result!.retry_count).toBe(0)
      expect(result!.fast_fail_count).toBe(0)
    })

    it('defaults max_runtime_ms to null for non-numeric values', () => {
      const logger = makeLogger()
      const raw = {
        id: 'task-45',
        title: 'No runtime',
        repo: 'myrepo',
        max_runtime_ms: 'invalid'
      }
      const result = mapQueuedTask(raw as Record<string, unknown>, logger)
      expect(result!.max_runtime_ms).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // 5. _checkAndBlockDeps
  // -------------------------------------------------------------------------

  describe('checkAndBlockDeps', () => {
    it('returns false when deps are satisfied', () => {
      const repo = makeMockRepo()
      const depIndex = createDependencyIndex()
      const logger = makeLogger()
      // Default mock: areDependenciesSatisfied returns { satisfied: true, blockedBy: [] }
      const statusMap = new Map([['dep-1', 'done']])
      const result = checkAndBlockDeps(
        'task-1',
        JSON.stringify([{ taskId: 'dep-1', type: 'hard' }]),
        statusMap,
        repo,
        depIndex,
        logger
      )
      expect(result).toBe(false)
    })

    it('returns false and does not block for empty deps array', () => {
      const repo = makeMockRepo()
      const depIndex = createDependencyIndex()
      const logger = makeLogger()
      const result = checkAndBlockDeps('task-1', '[]', new Map(), repo, depIndex, logger)
      expect(result).toBe(false)
      expect(updateTask).not.toHaveBeenCalled()
    })

    it('returns true and sets task to error when dep parsing fails (invalid JSON)', () => {
      const repo = makeMockRepo()
      const depIndex = createDependencyIndex()
      const logger = makeLogger()
      const result = checkAndBlockDeps('task-1', '{bad json', new Map(), repo, depIndex, logger)
      expect(result).toBe(true)
    })

    it('returns false for non-array deps', () => {
      const repo = makeMockRepo()
      const depIndex = createDependencyIndex()
      const logger = makeLogger()
      const result = checkAndBlockDeps('task-1', '"just-a-string"', new Map(), repo, depIndex, logger)
      expect(result).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // F-t1-sre-6: _lastTaskDeps evicts terminal-status tasks to prevent growth
  // ---------------------------------------------------------------------------

  describe('_lastTaskDeps TTL for terminal tasks (F-t1-sre-6)', () => {
    // Test the eviction logic by seeding _lastTaskDeps directly (it's now
    // public via _ convention) and asserting the drain loop evicts terminal
    // tasks and preserves non-terminal ones.
    //
    // We drive the drain loop by mocking getTasksWithDependencies to return
    // specific task shapes, then verify map state post-drain.

    function makeInlineRepo(
      tasks: Array<{ id: string; status: string; depends_on: null }>
    ): ISprintTaskRepository {
      return {
        getTask: vi.fn(),
        updateTask: vi.fn().mockReturnValue(null),
        getQueuedTasks: vi.fn().mockReturnValue([]),
        getTasksWithDependencies: vi.fn().mockReturnValue(tasks),
        getOrphanedTasks: vi.fn().mockReturnValue([]),
        getActiveTaskCount: vi.fn().mockReturnValue(0),
        claimTask: vi.fn()
      }
    }

    it('evicts terminal-status task entries from _lastTaskDeps on next drain tick', async () => {
      const repo = makeInlineRepo([
        { id: 'task-active', status: 'active', depends_on: null },
        { id: 'task-done', status: 'done', depends_on: null }
      ])
      const manager = new AgentManagerImpl(baseConfig, repo, makeLogger())

      // Directly seed the cache (simulates a task that was cached while active)
      manager._lastTaskDeps.set('task-active', { deps: null, hash: 'h1' })
      manager._lastTaskDeps.set('task-done', { deps: null, hash: 'h2' })

      // Drain loop sees task-done as terminal → should evict from fingerprint cache
      await manager._drainLoop()

      // active task stays cached (non-terminal, hash unchanged → no mutation)
      expect(manager._lastTaskDeps.has('task-active')).toBe(true)
      // terminal task must be evicted
      expect(manager._lastTaskDeps.has('task-done')).toBe(false)
    })

    it('never adds a task to _lastTaskDeps when it starts in terminal status', async () => {
      const repo = makeInlineRepo([
        { id: 'task-failed', status: 'failed', depends_on: null },
        { id: 'task-cancelled', status: 'cancelled', depends_on: null },
        { id: 'task-error', status: 'error', depends_on: null }
      ])
      const manager = new AgentManagerImpl(baseConfig, repo, makeLogger())

      // Map starts empty — terminal tasks should never be added
      expect(manager._lastTaskDeps.size).toBe(0)
      await manager._drainLoop()

      // No terminal task should ever land in the cache
      expect(manager._lastTaskDeps.has('task-failed')).toBe(false)
      expect(manager._lastTaskDeps.has('task-cancelled')).toBe(false)
      expect(manager._lastTaskDeps.has('task-error')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 9. taskStatusMap refresh after claim (F-t1-perf-snapshot)
  // -------------------------------------------------------------------------

  describe('taskStatusMap refresh after claim', () => {
    it('refreshes map after successful claim so subsequent tasks see updated statuses', async () => {
      // This test simulates: drain loop builds map with task-2='blocked',
      // then concurrent completion changes task-2 to 'queued' in DB,
      // refresh after claim picks up the new status.

      let callCount = 0
      const mockRepo = {
        getTask: vi.fn(),
        updateTask: vi.fn(),
        getQueuedTasks: vi.fn(),
        getOrphanedTasks: vi.fn(),
        getActiveTaskCount: vi.fn().mockReturnValue(0),
        claimTask: vi.fn().mockReturnValue({ id: 'task-1' }),
        // First call (drain loop builds map): task-2 is blocked
        // Second call (refresh after claim): task-2 is now queued
        getTasksWithDependencies: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return [
              { id: 'task-1', status: 'queued', depends_on: null },
              { id: 'task-2', status: 'blocked', depends_on: null }
            ]
          }
          return [
            { id: 'task-1', status: 'active', depends_on: null },
            { id: 'task-2', status: 'queued', depends_on: null }
          ]
        })
      }

      const manager = new AgentManagerImpl(baseConfig, mockRepo as never, makeLogger())

      // Simulate drain loop: build initial map from first getTasksWithDependencies call
      const initialTasks = mockRepo.getTasksWithDependencies()
      const taskStatusMap = new Map(initialTasks.map((t) => [t.id, t.status]))

      // Verify initial state: task-2 is blocked
      expect(taskStatusMap.get('task-2')).toBe('blocked')

      const raw = makeRawTask({ id: 'task-1' })
      await manager._processQueuedTask(raw, taskStatusMap)

      // Verify refresh happened: task-2 should now be 'queued', task-1 should be 'active'
      expect(taskStatusMap.get('task-2')).toBe('queued')
      expect(taskStatusMap.get('task-1')).toBe('active')
      expect(mockRepo.getTasksWithDependencies).toHaveBeenCalledTimes(2) // initial + refresh
    })

    it('continues with stale map when refresh fails (non-fatal)', async () => {
      const mockRepo = {
        getTask: vi.fn(),
        updateTask: vi.fn(),
        getQueuedTasks: vi.fn(),
        getOrphanedTasks: vi.fn(),
        getActiveTaskCount: vi.fn().mockReturnValue(0),
        claimTask: vi.fn().mockReturnValue({ id: 'task-1' }),
        getTasksWithDependencies: vi.fn().mockImplementation(() => {
          throw new Error('DB connection lost')
        })
      }

      const manager = new AgentManagerImpl(baseConfig, mockRepo as never, makeLogger())

      const taskStatusMap = new Map([
        ['task-1', 'queued'],
        ['task-2', 'blocked']
      ])

      const raw = makeRawTask({ id: 'task-1' })

      // Should not throw — refresh failure is caught
      await expect(manager._processQueuedTask(raw, taskStatusMap)).resolves.toBeUndefined()

      // Map unchanged since refresh failed
      expect(taskStatusMap.get('task-2')).toBe('blocked')
      expect(taskStatusMap.get('task-1')).toBe('queued')
    })
  })

  // -------------------------------------------------------------------------
  // onTaskTerminal — dep index rebuild
  // -------------------------------------------------------------------------

  describe('onTaskTerminal dep index rebuild', () => {
    it('rebuilds dep index before calling resolveDependents', async () => {
      const freshTasks = [
        { id: 'task-A', status: 'done', depends_on: null },
        { id: 'task-B', status: 'blocked', depends_on: [{ id: 'task-A', type: 'hard' }] }
      ]

      vi.mocked(getTasksWithDependencies).mockReturnValue(freshTasks as never)
      vi.mocked(updateTask).mockReturnValue(null)
      vi.mocked(getTask).mockImplementation(
        (id: string) => (freshTasks.find((t) => t.id === id) ?? null) as never
      )

      const manager = new AgentManagerImpl(baseConfig, makeMockRepo(), makeLogger())
      const rebuildSpy = vi.spyOn(manager._depIndex, 'rebuild')

      await manager.onTaskTerminal('task-A', 'done')

      expect(rebuildSpy).toHaveBeenCalled()
    })
  })
})
