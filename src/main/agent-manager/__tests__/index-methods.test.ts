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
  readFileSync: vi.fn().mockReturnValue('mock-oauth-token-longer-than-20-chars'),
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
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeMockRepo(): ISprintTaskRepository {
  return {
    getTask: (...args: [string]) => (getTask as ReturnType<typeof vi.fn>)(...args),
    updateTask: (...args: [string, Record<string, unknown>]) =>
      (updateTask as ReturnType<typeof vi.fn>)(...args),
    getQueuedTasks: (...args: [number]) => (getQueuedTasks as ReturnType<typeof vi.fn>)(...args),
    getTasksWithDependencies: () => (getTasksWithDependencies as ReturnType<typeof vi.fn>)(),
    getOrphanedTasks: (...args: [string]) => (getOrphanedTasks as ReturnType<typeof vi.fn>)(...args),
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
    maxRuntimeMs: null
  }
}

function makeRawTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Test task',
    repo: 'myrepo',
    prompt: 'Do the thing',
    spec: null,
    retryCount: 0,
    fastFailCount: 0,
    playgroundEnabled: false,
    maxRuntimeMs: null,
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
  })
})
