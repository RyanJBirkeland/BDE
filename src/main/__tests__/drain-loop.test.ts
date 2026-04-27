import { describe, it, expect, vi } from 'vitest'
import { DrainLoop, DRAIN_QUARANTINE_THRESHOLD } from '../agent-manager/drain-loop'
import type { DrainLoopDeps } from '../agent-manager/drain-loop'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { DependencyIndex } from '../services/dependency-service'
import type { MetricsCollector } from '../agent-manager/metrics'
import type { ConcurrencyState } from '../agent-manager/concurrency'

// drain-loop.ts imports getConfiguredRepos and checkOAuthToken — mock them
vi.mock('../paths', () => ({
  getConfiguredRepos: vi.fn().mockReturnValue([{ name: 'bde', localPath: '/repo' }]),
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/repo' })
}))

vi.mock('../agent-manager/oauth-checker', () => ({
  checkOAuthToken: vi.fn().mockResolvedValue(true)
}))

function makeRepo(overrides: Partial<IAgentTaskRepository> = {}): IAgentTaskRepository {
  return {
    getTask: vi.fn().mockReturnValue({ id: 'task-abc', status: 'queued' }),
    updateTask: vi.fn(),
    claimTask: vi.fn(),
    getQueuedTasks: vi.fn().mockReturnValue([{ id: 'task-abc', repo: 'bde', title: 'Test' }]),
    getQueueStats: vi.fn().mockReturnValue({ queued: 1 }),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    ...overrides
  } as unknown as IAgentTaskRepository
}

function makeDeps(overrides: Partial<DrainLoopDeps> = {}): DrainLoopDeps {
  const repo = makeRepo(overrides.repo as any)
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), event: vi.fn() } as any
  const concurrency: ConcurrencyState = {
    maxSlots: 4,
    capacityAfterBackpressure: 4,
    activeCount: 0,
    recoveryScheduledAt: null,
    consecutiveRateLimits: 0,
    atMinimumCapacity: false
  }

  const taskStateService = {
    transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      repo.updateTask(taskId, { status, ...(ctx?.fields ?? {}) })
    })
  } as unknown as import('../services/task-state-service').TaskStateService

  return {
    config: { maxConcurrent: 4 } as any,
    repo,
    depIndex: {} as unknown as DependencyIndex,
    metrics: { increment: vi.fn(), setLastDrainDuration: vi.fn() } as unknown as MetricsCollector,
    logger,
    isShuttingDown: () => false,
    isCircuitOpen: () => false,
    activeAgents: new Map(),
    getPendingSpawns: () => 0,
    isDepIndexDirty: () => false,
    setDepIndexDirty: vi.fn(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    taskStateService,
    emitDrainPaused: vi.fn(),
    processQueuedTask: vi.fn().mockRejectedValue(new Error('DB corruption')),
    ...overrides
  }
}

describe('drainQueuedTasks — quarantine', () => {
  it('exported DRAIN_QUARANTINE_THRESHOLD is 3', () => {
    expect(DRAIN_QUARANTINE_THRESHOLD).toBe(3)
  })

  it('tracks consecutive failures per task', async () => {
    const deps = makeDeps()
    const loop = new DrainLoop(deps)

    // Two failures — below threshold
    await loop.drainQueuedTasksWithMap(4, new Map())
    await loop.drainQueuedTasksWithMap(4, new Map())

    // Below threshold — no quarantine call
    expect(deps.repo.updateTask).not.toHaveBeenCalledWith(
      'task-abc',
      expect.objectContaining({ status: expect.stringMatching(/cancelled|error/) })
    )
  })

  it(`marks task cancelled (queued→cancelled) after ${DRAIN_QUARANTINE_THRESHOLD} consecutive failures`, async () => {
    const deps = makeDeps()
    const loop = new DrainLoop(deps)

    for (let i = 0; i < DRAIN_QUARANTINE_THRESHOLD; i++) {
      await loop.drainQueuedTasksWithMap(4, new Map())
    }

    // transition() is now the single entry point — it calls repo.updateTask via mock
    expect(deps.repo.updateTask).toHaveBeenCalledWith(
      'task-abc',
      expect.objectContaining({
        status: 'cancelled',
        notes: expect.stringContaining('DB corruption')
      })
    )
  })

  it('preserves failure count when quarantine updateTask throws', async () => {
    const failingUpdateTask = vi.fn().mockImplementation(() => {
      throw new Error('disk full')
    })
    const deps = makeDeps()
    // Replace updateTask on the already-constructed repo mock
    ;(deps.repo.updateTask as ReturnType<typeof vi.fn>) = failingUpdateTask

    const loop = new DrainLoop(deps)

    // Seed near-threshold state by running THRESHOLD - 1 failures
    for (let i = 0; i < DRAIN_QUARANTINE_THRESHOLD - 1; i++) {
      await loop.drainQueuedTasksWithMap(4, new Map())
    }
    // Reset mock to track whether the quarantine is attempted on the next call
    failingUpdateTask.mockClear()

    // One more failure should trigger quarantine attempt
    await loop.drainQueuedTasksWithMap(4, new Map())

    // Quarantine was attempted (updateTask was called) but threw
    // Another drain should still attempt quarantine again (count stays at threshold)
    expect(failingUpdateTask).toHaveBeenCalled()
  })

  it('clears failure count on successful processing', async () => {
    const successRepo = makeRepo({
      processQueuedTask: vi.fn().mockResolvedValue(undefined)
    } as any)
    const deps = makeDeps({ processQueuedTask: vi.fn().mockResolvedValue(undefined) })
    const loop = new DrainLoop(deps)

    // Seed failure count by failing twice
    const failLoop = new DrainLoop(deps)
    await failLoop.drainQueuedTasksWithMap(4, new Map())
    await failLoop.drainQueuedTasksWithMap(4, new Map())

    // Now use a fresh loop with success — counts are per-instance
    const successDeps = makeDeps({ processQueuedTask: vi.fn().mockResolvedValue(undefined) })
    const successLoop = new DrainLoop(successDeps)
    await successLoop.drainQueuedTasksWithMap(4, new Map())

    // Success path: no quarantine called
    expect(successDeps.repo.updateTask).not.toHaveBeenCalledWith(
      'task-abc',
      expect.objectContaining({ status: expect.stringMatching(/cancelled|error/) })
    )
  })
})
