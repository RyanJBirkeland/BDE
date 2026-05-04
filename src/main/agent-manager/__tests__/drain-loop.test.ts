import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { DependencyIndex } from '../../services/dependency-service'

vi.mock('../oauth-checker', () => ({
  checkOAuthToken: vi.fn().mockResolvedValue(true)
}))
vi.mock('../dependency-refresher', () => ({
  refreshDependencyIndex: vi.fn().mockReturnValue(new Map()),
  computeDepsFingerprint: vi.fn().mockReturnValue('hash'),
  type: undefined
}))
vi.mock('../concurrency', async () => {
  const actual = await vi.importActual<typeof import('../concurrency')>('../concurrency')
  return { ...actual }
})
vi.mock('../../paths', () => ({
  getConfiguredRepos: vi.fn().mockReturnValue([{ name: 'fleet', localPath: '/tmp/fleet' }])
}))

import {
  DrainLoop,
  DRAIN_TICK_TIMEOUT_MS,
  type DrainLoopDeps
} from '../drain-loop'
import { DRAIN_PAUSE_ON_ENV_ERROR_MS } from '../types'
import { checkOAuthToken } from '../oauth-checker'
import { refreshDependencyIndex } from '../dependency-refresher'
import { makeConcurrencyState } from '../concurrency'
import type { AgentManagerConfig } from '../types'
import { DEFAULT_CONFIG as _DEFAULT_CONFIG, DEFAULT_MODEL } from '../types'
import { getConfiguredRepos } from '../../paths'

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees',
  maxRuntimeMs: 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: DEFAULT_MODEL
}

function makeRepo(): IAgentTaskRepository {
  return {
    updateTask: vi.fn().mockResolvedValue(null),
    getTask: vi.fn(),
    claimTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn().mockResolvedValue(null),
    listActiveAgentRuns: vi.fn().mockReturnValue([]),
    getQueueStats: vi.fn().mockReturnValue({
      queued: 0,
      blocked: 0,
      active: 0,
      review: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      error: 0
    })
  } as unknown as IAgentTaskRepository
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
}

function makeMetrics() {
  return {
    increment: vi.fn(),
    setLastDrainDuration: vi.fn(),
    recordWatchdogVerdict: vi.fn()
  }
}

function makeDepIndex(): DependencyIndex {
  return {
    rebuild: vi.fn(),
    getBlockedBy: vi.fn(),
    addEdges: vi.fn()
  } as unknown as DependencyIndex
}

function makeTaskStateService(repo: IAgentTaskRepository) {
  return {
    transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      repo.updateTask(taskId, { status, ...(ctx?.fields ?? {}) })
    })
  } as unknown as import('../../services/task-state-service').TaskStateService
}

function makeDeps(overrides: Partial<DrainLoopDeps> = {}): DrainLoopDeps {
  const concurrency = makeConcurrencyState(2)
  const repo = (overrides.repo as IAgentTaskRepository | undefined) ?? makeRepo()
  return {
    config: baseConfig,
    repo,
    depIndex: makeDepIndex(),
    metrics: makeMetrics() as any,
    logger: makeLogger(),
    isShuttingDown: () => false,
    isCircuitOpen: () => false,
    circuitOpenUntil: 0,
    activeAgentCount: () => 0,
    getConcurrency: () => concurrency,
    getPendingSpawns: () => 0,
    lastTaskDeps: new Map(),
    isDepIndexDirty: () => false,
    setDepIndexDirty: vi.fn(),
    setConcurrency: vi.fn(),
    processQueuedTask: vi.fn().mockResolvedValue(undefined),
    incrementDrainFailure: vi.fn(),
    clearDrainFailure: vi.fn(),
    drainFailureCountFor: vi.fn().mockReturnValue(0),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    taskStateService: makeTaskStateService(repo),
    emitDrainPaused: vi.fn(),
    drainPausedUntil: undefined,
    recentlyProcessedTaskIds: new Set<string>(),
    getConfiguredRepos,
    ...overrides
  }
}

describe('validateDrainPreconditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when shutting down', async () => {
    const deps = makeDeps({ isShuttingDown: () => true })
    expect(await new DrainLoop(deps).validateDrainPreconditions()).toBe(false)
  })

  it('returns false and logs when circuit is open', async () => {
    const deps = makeDeps({
      isCircuitOpen: () => true,
      circuitOpenUntil: Date.now() + 60_000
    })
    expect(await new DrainLoop(deps).validateDrainPreconditions()).toBe(false)
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('circuit breaker open'))
  })

  it('returns false and logs when no repositories are configured', async () => {
    vi.mocked(getConfiguredRepos).mockReturnValue([])
    const deps = makeDeps()
    expect(await new DrainLoop(deps).validateDrainPreconditions()).toBe(false)
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No repositories configured')
    )
    vi.mocked(getConfiguredRepos).mockReturnValue([{ name: 'fleet', localPath: '/tmp/fleet' }])
  })

  it('returns false and logs when OAuth token is invalid', async () => {
    vi.mocked(checkOAuthToken).mockResolvedValue(false)
    const deps = makeDeps()
    expect(await new DrainLoop(deps).validateDrainPreconditions()).toBe(false)
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('OAuth token invalid'))
  })

  it('returns true when all preconditions pass', async () => {
    vi.mocked(checkOAuthToken).mockResolvedValue(true)
    const deps = makeDeps()
    expect(await new DrainLoop(deps).validateDrainPreconditions()).toBe(true)
  })
})

describe('buildTaskStatusMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls refreshDependencyIndex when dep index is clean', () => {
    const statusMap = new Map([['task-1', 'active']])
    vi.mocked(refreshDependencyIndex).mockReturnValue(statusMap)
    const deps = makeDeps({ isDepIndexDirty: () => false })
    const result = new DrainLoop(deps).buildTaskStatusMap()
    expect(refreshDependencyIndex).toHaveBeenCalled()
    // filterToValidTaskStatuses returns a new Map; verify the valid entries survive
    expect(result.get('task-1')).toBe('active')
  })

  it('rebuilds from scratch when dep index is dirty', () => {
    const repo = makeRepo()
    vi.mocked(repo.getTasksWithDependencies).mockReturnValue([
      { id: 'task-1', status: 'queued', depends_on: null } as any
    ])
    const setDepIndexDirty = vi.fn()
    const deps = makeDeps({ repo, isDepIndexDirty: () => true, setDepIndexDirty })
    const result = new DrainLoop(deps).buildTaskStatusMap()
    expect(deps.depIndex.rebuild).toHaveBeenCalled()
    expect(setDepIndexDirty).toHaveBeenCalledWith(false)
    expect(result.get('task-1')).toBe('queued')
  })

  it('passes a hint set when dep index is dirty and recently processed task IDs are non-empty', () => {
    const repo = makeRepo()
    vi.mocked(repo.getTasksWithDependencies).mockReturnValue([
      { id: 'task-hint', status: 'done', depends_on: null } as any
    ])
    const setDepIndexDirty = vi.fn()
    const deps = makeDeps({ repo, isDepIndexDirty: () => true, setDepIndexDirty })
    const loop = new DrainLoop(deps)
    loop.notifyRecentlyProcessedTask('task-hint')

    loop.buildTaskStatusMap()

    const [hint] = vi.mocked(repo.getTasksWithDependencies).mock.calls[0]
    expect(hint).toBeInstanceOf(Set)
    expect((hint as Set<string>).has('task-hint')).toBe(true)
  })

  it('performs a full scan when dep index is dirty but no recently processed task IDs', () => {
    const repo = makeRepo()
    vi.mocked(repo.getTasksWithDependencies).mockReturnValue([
      { id: 'task-full', status: 'queued', depends_on: null } as any
    ])
    const setDepIndexDirty = vi.fn()
    const deps = makeDeps({ repo, isDepIndexDirty: () => true, setDepIndexDirty })
    const loop = new DrainLoop(deps)
    // Do not call notifyRecentlyProcessedTask — set is empty

    loop.buildTaskStatusMap()

    const [hint] = vi.mocked(repo.getTasksWithDependencies).mock.calls[0]
    expect(hint).toBeUndefined()
  })
})

describe('drainQueuedTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes each queued task', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-1' }, { id: 'task-2' }] as any)
    const processQueuedTask = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ repo, processQueuedTask })
    const taskStatusMap = new Map<string, string>()

    await new DrainLoop(deps).drainQueuedTasksWithMap(2, taskStatusMap)

    expect(processQueuedTask).toHaveBeenCalledTimes(2)
  })

  it('stops early when shutting down mid-loop', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-1' }, { id: 'task-2' }] as any)
    let called = 0
    const isShuttingDown = vi.fn().mockImplementation(() => called >= 1)
    const processQueuedTask = vi.fn().mockImplementation(async () => {
      called++
    })
    const deps = makeDeps({ repo, isShuttingDown, processQueuedTask })

    await new DrainLoop(deps).drainQueuedTasksWithMap(2, new Map())

    expect(processQueuedTask).toHaveBeenCalledTimes(1)
  })

  it('logs errors from individual tasks without aborting the loop', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-1' }, { id: 'task-2' }] as any)
    const processQueuedTask = vi
      .fn()
      .mockRejectedValueOnce(new Error('task error'))
      .mockResolvedValueOnce(undefined)
    const deps = makeDeps({ repo, processQueuedTask })

    await new DrainLoop(deps).drainQueuedTasksWithMap(2, new Map())

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to process task')
    )
    expect(processQueuedTask).toHaveBeenCalledTimes(2)
  })
})

describe('runDrain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkOAuthToken).mockResolvedValue(true)
    vi.mocked(refreshDependencyIndex).mockReturnValue(new Map())
  })

  it('skips drain when preconditions fail', async () => {
    const deps = makeDeps({ isShuttingDown: () => true })
    await new DrainLoop(deps).runDrain()
    expect(deps.metrics.increment).not.toHaveBeenCalled()
  })

  it('increments drainLoopCount when drain runs', async () => {
    const deps = makeDeps()
    await new DrainLoop(deps).runDrain()
    expect(deps.metrics.increment).toHaveBeenCalledWith('drainLoopCount')
  })

  it('skips task processing when no slots are available', async () => {
    const concurrency = makeConcurrencyState(1)
    const deps = makeDeps({
      getConcurrency: () => concurrency,
      activeAgentCount: () => 1
    })
    await new DrainLoop(deps).runDrain()
    expect(deps.processQueuedTask).not.toHaveBeenCalled()
  })

  it('records drain duration', async () => {
    const deps = makeDeps()
    await new DrainLoop(deps).runDrain()
    expect(deps.metrics.setLastDrainDuration).toHaveBeenCalledWith(expect.any(Number))
  })

  it('short-circuits when drainPausedUntil is in the future', async () => {
    // DrainLoop owns drainPausedUntil as private state (T-58).
    // Trigger an environmental failure to set the pause, then verify the next
    // runDrain() call short-circuits (metrics.increment not called again).
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-env' }] as any)
    vi.mocked(repo.getQueueStats).mockReturnValue({ queued: 1, active: 0, blocked: 0, done: 0, failed: 0, cancelled: 0, error: 0 })

    const processQueuedTask = vi.fn().mockRejectedValue(new Error('credential unavailable: invalid auth token'))
    const deps = makeDeps({ repo, processQueuedTask })
    const loop = new DrainLoop(deps)

    // First call — triggers environmental pause
    await loop.runDrain()
    const incrementCallsAfterFirst = vi.mocked(deps.metrics.increment).mock.calls.length

    // Second call — should short-circuit (drain is paused)
    await loop.runDrain()
    // increment should not have been called again for the second run
    expect(vi.mocked(deps.metrics.increment).mock.calls.length).toBe(incrementCallsAfterFirst)
    expect(processQueuedTask).toHaveBeenCalledTimes(1) // only on first call
  })
})

describe('drain-loop: tick deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkOAuthToken).mockResolvedValue(true)
    vi.mocked(refreshDependencyIndex).mockReturnValue(new Map())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips tick and logs drain.tick.timeout when getQueuedTasks hangs past the deadline', async () => {
    vi.useFakeTimers()
    const repo = makeRepo()
    // getQueuedTasks never resolves — simulates a hung DB read
    vi.mocked(repo.getQueuedTasks).mockImplementation(() => {
      return new Promise<never>(() => {}) as unknown as ReturnType<
        IAgentTaskRepository['getQueuedTasks']
      >
    })
    const processQueuedTask = vi.fn()
    const deps = makeDeps({ repo, processQueuedTask })

    const loop = new DrainLoop(deps)
    const drainPromise = loop.drainQueuedTasksWithMap(2, new Map())
    // Advance past the deadline
    await vi.advanceTimersByTimeAsync(DRAIN_TICK_TIMEOUT_MS + 100)
    await drainPromise

    // Tick was skipped — no tasks processed
    expect(processQueuedTask).not.toHaveBeenCalled()
    // drain.tick.timeout event was logged
    expect(deps.logger.event).toHaveBeenCalledWith('drain.tick.timeout', expect.objectContaining({ tickId: expect.anything() }))
  })

  it('processes tasks normally when getQueuedTasks returns within the deadline', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-fast' }] as any)
    const processQueuedTask = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ repo, processQueuedTask })

    await new DrainLoop(deps).drainQueuedTasksWithMap(2, new Map())

    expect(processQueuedTask).toHaveBeenCalledTimes(1)
    expect(deps.logger.event).not.toHaveBeenCalledWith('drain.tick.timeout', expect.anything())
  })
})

describe('drain-loop: environmental failure pauses drain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function envErrorRepo(): IAgentTaskRepository {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-env' }] as any)
    vi.mocked(repo.getQueueStats).mockReturnValue({
      queued: 7,
      blocked: 0,
      active: 0,
      review: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      error: 0
    } as any)
    return repo
  }

  it('does not transition the task to error on environmental failure', async () => {
    const repo = envErrorRepo()
    const emitDrainPaused = vi.fn()
    const processQueuedTask = vi
      .fn()
      .mockRejectedValue(new Error('Main repo has uncommitted changes (pre-ffMergeMain)'))
    const deps = makeDeps({ repo, processQueuedTask, emitDrainPaused })

    await new DrainLoop(deps).drainQueuedTasksWithMap(1, new Map())

    const updateCalls = vi.mocked(repo.updateTask).mock.calls
    expect(updateCalls.length).toBe(1)
    const [updatedId, patch] = updateCalls[0]
    expect(updatedId).toBe('task-env')
    expect(patch.status).toBe('queued')
    expect(patch.status).not.toBe('error')
    expect(patch.failure_reason).toBe('environmental')
    expect(patch.claimed_by).toBeNull()
    expect(emitDrainPaused).toHaveBeenCalledTimes(1)
    const event = emitDrainPaused.mock.calls[0][0]
    expect(event.reason).toMatch(/main repo/i)
    expect(event.affectedTaskCount).toBe(7)
    expect(event.pausedUntil).toBeGreaterThan(Date.now())
  })

  it('populates failure_reason but keeps status queued', async () => {
    const repo = envErrorRepo()
    const processQueuedTask = vi
      .fn()
      .mockRejectedValue(new Error('credential unavailable for fleet repo'))
    const deps = makeDeps({ repo, processQueuedTask })

    await new DrainLoop(deps).drainQueuedTasksWithMap(1, new Map())

    const [, patch] = vi.mocked(repo.updateTask).mock.calls[0]
    expect(patch.status).toBe('queued')
    expect(patch.failure_reason).toBe('environmental')
    expect(patch.notes).toMatch(/credential unavailable/i)
  })

  it('still errors the task on spec-level (non-environmental) failure', async () => {
    // DrainLoop owns drainFailureCounts as private state (T-58).
    // Build up the count by calling drainQueuedTasksWithMap multiple times on the same instance.
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-spec' }] as any)
    vi.mocked(repo.getTask).mockReturnValue({ id: 'task-spec', status: 'active' } as any)
    const emitDrainPaused = vi.fn()
    const processQueuedTask = vi
      .fn()
      .mockRejectedValue(new Error('TypeError: foo is not a function'))
    const deps = makeDeps({ repo, processQueuedTask, emitDrainPaused })
    const loop = new DrainLoop(deps)

    // Call twice to build up count to DRAIN_QUARANTINE_THRESHOLD - 1 (2), then once more to trip
    await loop.drainQueuedTasksWithMap(1, new Map())
    await loop.drainQueuedTasksWithMap(1, new Map())
    await loop.drainQueuedTasksWithMap(1, new Map())

    const updateCalls = vi.mocked(repo.updateTask).mock.calls
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)
    const statusPatch = updateCalls.find(([, patch]) => patch.status === 'error' || patch.status === 'cancelled')
    expect(statusPatch).toBeDefined()
    expect(emitDrainPaused).not.toHaveBeenCalled()
  })

  it('does not pause when the failure classifier returns a non-environmental category', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-spec' }] as any)
    const emitDrainPaused = vi.fn()
    const processQueuedTask = vi.fn().mockRejectedValue(new Error('Syntax error in spec'))
    const deps = makeDeps({ repo, processQueuedTask, emitDrainPaused })

    await new DrainLoop(deps).drainQueuedTasksWithMap(1, new Map())

    expect(emitDrainPaused).not.toHaveBeenCalled()
    // First spec-level failure shouldn't update the task (count < threshold).
    expect(vi.mocked(repo.updateTask)).not.toHaveBeenCalled()
  })
})

// ── T-18: filterToValidTaskStatuses excludes invalid statuses from the map ───

describe('buildTaskStatusMap — T-18: invalid statuses excluded from dependency index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkOAuthToken).mockResolvedValue(true)
  })

  it('excludes a task with an unrecognised status from the rebuilt status map', () => {
    const repo = makeRepo()
    vi.mocked(repo.getTasksWithDependencies).mockReturnValue([
      { id: 'task-valid', status: 'queued', depends_on: null } as any,
      { id: 'task-bad', status: 'not_a_real_status', depends_on: null } as any
    ])
    const deps = makeDeps({ repo, isDepIndexDirty: () => true })

    const result = new DrainLoop(deps).buildTaskStatusMap()

    expect(result.has('task-valid')).toBe(true)
    expect(result.has('task-bad')).toBe(false)
  })

  it('logs a warning for each task with an unrecognised status', () => {
    const repo = makeRepo()
    vi.mocked(repo.getTasksWithDependencies).mockReturnValue([
      { id: 'task-weird', status: 'limbo', depends_on: null } as any
    ])
    const deps = makeDeps({ repo, isDepIndexDirty: () => true })

    new DrainLoop(deps).buildTaskStatusMap()

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('task-weird')
    )
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('limbo')
    )
  })

  it('excludes invalid statuses from the incremental refresh path via filterToValidTaskStatuses', () => {
    // The incremental path goes through refreshDependencyIndex which returns Map<string, string>.
    // The filter should strip any value that is not a valid TaskStatus.
    const rawMap = new Map<string, string>([
      ['task-ok', 'active'],
      ['task-unknown', 'unknownstatus']
    ])
    vi.mocked(refreshDependencyIndex).mockReturnValue(rawMap)
    const deps = makeDeps({ isDepIndexDirty: () => false })

    const result = new DrainLoop(deps).buildTaskStatusMap()

    expect(result.has('task-ok')).toBe(true)
    expect(result.has('task-unknown')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T-47 · P0 — quarantineStatusFor returns correct status per input
// ---------------------------------------------------------------------------
// quarantineStatusFor is private, so we exercise it through the public
// applyQuarantine path: trigger DRAIN_QUARANTINE_THRESHOLD spec-level failures
// on a task with the given status, then assert the transition target status.

describe('T-47: quarantineStatusFor routes queued→cancelled, others→error', () => {
  const THRESHOLD = 3 // DRAIN_QUARANTINE_THRESHOLD

  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function triggerQuarantine(
    taskId: string,
    initialStatus: string,
    makeTaskStateServiceFn: () => import('../../services/task-state-service').TaskStateService
  ): Promise<string | undefined> {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: taskId }] as any)
    vi.mocked(repo.getTask).mockReturnValue({ id: taskId, status: initialStatus } as any)

    const taskStateService = makeTaskStateServiceFn()
    const processQueuedTask = vi.fn().mockRejectedValue(new Error('spec-level: TypeError: x is undefined'))
    const deps = makeDeps({ repo, processQueuedTask, taskStateService })
    const loop = new DrainLoop(deps)

    for (let i = 0; i < THRESHOLD; i++) {
      await loop.drainQueuedTasksWithMap(1, new Map())
    }

    const calls = vi.mocked(taskStateService.transition).mock.calls
    if (calls.length === 0) return undefined
    return calls[calls.length - 1]?.[1] as string
  }

  it('transitions to cancelled when task is queued', async () => {
    const makeTs = () => ({
      transition: vi.fn().mockResolvedValue({ committed: true })
    }) as unknown as import('../../services/task-state-service').TaskStateService

    const status = await triggerQuarantine('q-task', 'queued', makeTs)
    expect(status).toBe('cancelled')
  })

  it('transitions to error when task is active', async () => {
    const makeTs = () => ({
      transition: vi.fn().mockResolvedValue({ committed: true })
    }) as unknown as import('../../services/task-state-service').TaskStateService

    const status = await triggerQuarantine('a-task', 'active', makeTs)
    expect(status).toBe('error')
  })

  it('transitions to error when task is blocked', async () => {
    const makeTs = () => ({
      transition: vi.fn().mockResolvedValue({ committed: true })
    }) as unknown as import('../../services/task-state-service').TaskStateService

    const status = await triggerQuarantine('b-task', 'blocked', makeTs)
    expect(status).toBe('error')
  })

  it('transitions to error when task is review', async () => {
    const makeTs = () => ({
      transition: vi.fn().mockResolvedValue({ committed: true })
    }) as unknown as import('../../services/task-state-service').TaskStateService

    const status = await triggerQuarantine('r-task', 'review', makeTs)
    expect(status).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// T-53 · P1 — env-failure pause duration is within tolerance of DRAIN_PAUSE_ON_ENV_ERROR_MS
// ---------------------------------------------------------------------------

describe('T-53: env-failure pause duration within ±500ms of DRAIN_PAUSE_ON_ENV_ERROR_MS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets pausedUntil within ±500ms of Date.now() + DRAIN_PAUSE_ON_ENV_ERROR_MS', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'env-task' }] as any)
    vi.mocked(repo.getQueueStats).mockReturnValue({
      queued: 1, blocked: 0, active: 0, review: 0, done: 0, failed: 0, cancelled: 0, error: 0
    } as any)

    const emitDrainPaused = vi.fn()
    const processQueuedTask = vi
      .fn()
      .mockRejectedValue(new Error('Main repo has uncommitted changes (pre-ffMergeMain)'))
    const deps = makeDeps({ repo, processQueuedTask, emitDrainPaused })

    const before = Date.now()
    await new DrainLoop(deps).drainQueuedTasksWithMap(1, new Map())
    const after = Date.now()

    expect(emitDrainPaused).toHaveBeenCalledTimes(1)
    const { pausedUntil } = emitDrainPaused.mock.calls[0][0] as { pausedUntil: number }

    const expectedMin = before + DRAIN_PAUSE_ON_ENV_ERROR_MS - 500
    const expectedMax = after + DRAIN_PAUSE_ON_ENV_ERROR_MS + 500
    expect(pausedUntil).toBeGreaterThanOrEqual(expectedMin)
    expect(pausedUntil).toBeLessThanOrEqual(expectedMax)
  })
})
