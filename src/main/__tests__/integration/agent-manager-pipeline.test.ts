/**
 * Integration test: AgentManager drain → claim → spawn pipeline.
 *
 * Uses the same mock setup as src/main/agent-manager/__tests__/index.test.ts
 * but focuses on the end-to-end pipeline from queued task to spawned agent.
 */

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

vi.mock('../../agent-manager/dependency-index', () => ({
  createDependencyIndex: vi.fn(() => ({
    rebuild: vi.fn(),
    getDependents: vi.fn(() => new Set()),
    areDependenciesSatisfied: vi.fn(() => ({ satisfied: true, blockedBy: [] })),
  })),
}))

vi.mock('../../agent-manager/resolve-dependents', () => ({
  resolveDependents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn(),
  getGhRepo: vi.fn(),
  BDE_AGENT_LOG_PATH: '/tmp/bde-agent-integration-test.log',
}))

vi.mock('../../agent-manager/sdk-adapter', () => ({
  spawnAgent: vi.fn(),
}))

vi.mock('../../agent-manager/worktree', () => ({
  setupWorktree: vi.fn(),
  cleanupWorktree: vi.fn(),
  pruneStaleWorktrees: vi.fn(),
  branchNameForTask: vi.fn(),
}))

vi.mock('../../agent-manager/completion', () => ({
  resolveSuccess: vi.fn(),
  resolveFailure: vi.fn(),
}))

vi.mock('../../agent-manager/orphan-recovery', () => ({
  recoverOrphans: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createAgentManager } from '../../agent-manager/index'
import type { AgentManagerConfig, AgentHandle } from '../../agent-manager/types'
import { getQueuedTasks, claimTask, updateTask } from '../../data/sprint-queries'
import { getRepoPaths } from '../../paths'
import { spawnAgent } from '../../agent-manager/sdk-adapter'
import { setupWorktree, pruneStaleWorktrees } from '../../agent-manager/worktree'
import { recoverOrphans } from '../../agent-manager/orphan-recovery'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees/bde-integration',
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
    id: 'task-pipeline-1',
    title: 'Pipeline test task',
    repo: 'myrepo',
    prompt: 'Build the feature',
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
  vi.mocked(setupWorktree).mockResolvedValue({
    worktreePath: '/tmp/wt/myrepo/task-pipeline-1',
    branch: 'agent/pipeline-test-task',
  })
}

function makeMockHandle(messages: unknown[] = []) {
  const abortFn = vi.fn()
  const steerFn = vi.fn().mockResolvedValue(undefined)
  async function* gen(): AsyncIterable<unknown> { for (const m of messages) yield m }
  return {
    handle: { messages: gen(), sessionId: 'mock-session', abort: abortFn, steer: steerFn } as AgentHandle,
    abortFn,
    steerFn,
  }
}

function makeBlockingHandle() {
  let resolveMessages: (() => void) | undefined
  const p = new Promise<void>((r) => { resolveMessages = r })
  const abortFn = vi.fn(() => { resolveMessages?.() })
  async function* gen(): AsyncIterable<unknown> { await p }
  return {
    handle: { messages: gen(), sessionId: 'blocking', abort: abortFn, steer: vi.fn().mockResolvedValue(undefined) } as AgentHandle,
    abortFn,
    resolve: () => resolveMessages?.(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentManager pipeline integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('drain loop picks up a queued task, claims it, and spawns an agent', async () => {
    vi.useFakeTimers()
    const logger = makeLogger()
    const task = makeTask()

    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
    vi.mocked(claimTask).mockResolvedValueOnce(task)
    const { handle } = makeMockHandle([{ type: 'text', content: 'done' }])
    vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

    const mgr = createAgentManager(baseConfig, logger)
    mgr.start()

    // Advance past INITIAL_DRAIN_DEFER_MS (5000ms) in small steps to let promises resolve
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(claimTask)).toHaveBeenCalledWith('task-pipeline-1', 'bde-embedded')
    expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Build the feature'),
        cwd: '/tmp/wt/myrepo/task-pipeline-1',
        model: 'claude-sonnet-4-5',
      })
    )

    mgr.stop(0).catch(() => {})
    vi.useRealTimers()
  })

  it('persists agent_run_id after successful spawn', async () => {
    vi.useFakeTimers()
    const logger = makeLogger()
    const task = makeTask()

    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
    vi.mocked(claimTask).mockResolvedValueOnce(task)
    const { handle } = makeMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

    const mgr = createAgentManager(baseConfig, logger)
    mgr.start()

    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
      'task-pipeline-1',
      expect.objectContaining({ agent_run_id: expect.any(String) })
    )

    mgr.stop(0).catch(() => {})
    vi.useRealTimers()
  })

  it('skips task when repo is not in config', async () => {
    vi.useFakeTimers()
    const logger = makeLogger()
    const task = makeTask({ repo: 'unknown-repo' })

    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])

    const mgr = createAgentManager(baseConfig, logger)
    mgr.start()

    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(claimTask)).not.toHaveBeenCalled()
    expect(vi.mocked(spawnAgent)).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No repo path'))

    mgr.stop(0).catch(() => {})
    vi.useRealTimers()
  })

  it('skips task when already claimed by another executor', async () => {
    vi.useFakeTimers()
    const logger = makeLogger()
    const task = makeTask()

    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
    vi.mocked(claimTask).mockResolvedValueOnce(null) // claim returns null = already taken

    const mgr = createAgentManager(baseConfig, logger)
    mgr.start()

    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(spawnAgent)).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('already claimed'))

    mgr.stop(0).catch(() => {})
    vi.useRealTimers()
  })

  it('marks task as error when spawnAgent fails', async () => {
    vi.useFakeTimers()
    const logger = makeLogger()
    const task = makeTask()

    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
    vi.mocked(claimTask).mockResolvedValueOnce(task)
    vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('OAuth token expired'))

    const mgr = createAgentManager(baseConfig, logger)
    mgr.start()

    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
      'task-pipeline-1',
      expect.objectContaining({ status: 'error' })
    )
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('spawnAgent failed'))

    mgr.stop(0).catch(() => {})
    vi.useRealTimers()
  })

  it('marks task as error when setupWorktree fails', async () => {
    vi.useFakeTimers()
    const logger = makeLogger()
    const task = makeTask()

    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
    vi.mocked(claimTask).mockResolvedValueOnce(task)
    vi.mocked(setupWorktree).mockRejectedValueOnce(new Error('git worktree add failed'))

    const mgr = createAgentManager(baseConfig, logger)
    mgr.start()

    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
      'task-pipeline-1',
      expect.objectContaining({ status: 'error' })
    )
    expect(vi.mocked(spawnAgent)).not.toHaveBeenCalled()

    mgr.stop(0).catch(() => {})
    vi.useRealTimers()
  })

  it('active agent appears in getStatus() while running', async () => {
    vi.useFakeTimers()
    const logger = makeLogger()
    const task = makeTask()
    const { handle } = makeBlockingHandle()

    vi.mocked(getQueuedTasks).mockResolvedValueOnce([task])
    vi.mocked(claimTask).mockResolvedValueOnce(task)
    vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

    const mgr = createAgentManager(baseConfig, logger)
    mgr.start()

    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    const status = mgr.getStatus()
    expect(status.running).toBe(true)
    expect(status.activeAgents.length).toBe(1)
    expect(status.activeAgents[0].taskId).toBe('task-pipeline-1')
    expect(status.concurrency.activeCount).toBe(1)

    mgr.stop(0).catch(() => {})
    vi.useRealTimers()
  })
})
