import { describe, it, expect, vi } from 'vitest'
import { drainQueuedTasks, DRAIN_QUARANTINE_THRESHOLD } from '../agent-manager/drain-loop'
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
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    ...overrides
  } as unknown as IAgentTaskRepository
}

function makeDeps(
  overrides: Partial<DrainLoopDeps> = {},
  drainFailureCounts = new Map<string, number>()
): DrainLoopDeps {
  const repo = makeRepo(overrides.repo as any)
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as any
  const concurrency: ConcurrencyState = {
    maxSlots: 4,
    capacityAfterBackpressure: 4,
    activeCount: 0,
    recoveryScheduledAt: null,
    consecutiveRateLimits: 0,
    atMinimumCapacity: false
  }

  return {
    config: { maxConcurrent: 4 } as any,
    repo,
    depIndex: {} as unknown as DependencyIndex,
    metrics: { increment: vi.fn(), setLastDrainDuration: vi.fn() } as unknown as MetricsCollector,
    logger,
    isShuttingDown: () => false,
    isCircuitOpen: () => false,
    circuitOpenUntil: 0,
    activeAgents: new Map(),
    getConcurrency: () => concurrency,
    getPendingSpawns: () => 0,
    lastTaskDeps: new Map(),
    isDepIndexDirty: () => false,
    setDepIndexDirty: vi.fn(),
    setConcurrency: vi.fn(),
    drainFailureCounts,
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    processQueuedTask: vi.fn().mockRejectedValue(new Error('DB corruption')),
    ...overrides
  }
}

describe('drainQueuedTasks — quarantine', () => {
  it('exported DRAIN_QUARANTINE_THRESHOLD is 3', () => {
    expect(DRAIN_QUARANTINE_THRESHOLD).toBe(3)
  })

  it('tracks consecutive failures per task', async () => {
    const counts = new Map<string, number>()
    const deps = makeDeps({}, counts)

    // Two failures — below threshold
    await drainQueuedTasks(4, new Map(), deps)
    await drainQueuedTasks(4, new Map(), deps)

    expect(counts.get('task-abc')).toBe(2)
    expect(deps.repo.updateTask).not.toHaveBeenCalledWith(
      'task-abc',
      expect.objectContaining({ status: expect.stringMatching(/cancelled|error/) })
    )
  })

  it(`marks task cancelled (queued→cancelled) after ${DRAIN_QUARANTINE_THRESHOLD} consecutive failures`, async () => {
    const counts = new Map<string, number>()
    const deps = makeDeps({}, counts)

    for (let i = 0; i < DRAIN_QUARANTINE_THRESHOLD; i++) {
      await drainQueuedTasks(4, new Map(), deps)
    }

    expect(deps.repo.updateTask).toHaveBeenCalledWith(
      'task-abc',
      expect.objectContaining({
        status: 'cancelled',
        notes: expect.stringContaining('DB corruption')
      })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-abc', 'cancelled')
    // Count cleared after quarantine
    expect(counts.has('task-abc')).toBe(false)
  })

  it('preserves failure count when quarantine updateTask throws', async () => {
    const counts = new Map<string, number>([['task-abc', DRAIN_QUARANTINE_THRESHOLD - 1]])
    // Pass updateTask override via makeRepo's partial overrides path (not top-level repo override)
    const failingUpdateTask = vi.fn().mockImplementation(() => {
      throw new Error('disk full')
    })
    const deps = makeDeps({}, counts)
    // Replace updateTask on the already-constructed repo mock
    ;(deps.repo.updateTask as ReturnType<typeof vi.fn>) = failingUpdateTask

    await drainQueuedTasks(4, new Map(), deps)

    // Quarantine attempt failed — count must still be at threshold, not cleared
    expect(counts.has('task-abc')).toBe(true)
    expect(counts.get('task-abc')).toBe(DRAIN_QUARANTINE_THRESHOLD)
  })

  it('clears failure count on successful processing', async () => {
    const counts = new Map<string, number>([['task-abc', 2]])
    const deps = makeDeps({ processQueuedTask: vi.fn().mockResolvedValue(undefined) }, counts)

    await drainQueuedTasks(4, new Map(), deps)

    expect(counts.has('task-abc')).toBe(false)
  })
})
