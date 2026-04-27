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
  getConfiguredRepos: vi.fn().mockReturnValue([{ name: 'bde', localPath: '/tmp/bde' }])
}))

import {
  validateDrainPreconditions,
  buildTaskStatusMap,
  drainQueuedTasks,
  runDrain,
  DRAIN_TICK_TIMEOUT_MS,
  type DrainLoopDeps
} from '../drain-loop'
import { checkOAuthToken } from '../oauth-checker'
import { refreshDependencyIndex } from '../dependency-refresher'
import { makeConcurrencyState } from '../concurrency'
import type { AgentManagerConfig } from '../types'
import { DEFAULT_CONFIG } from '../types'
import { getConfiguredRepos } from '../../paths'

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees',
  maxRuntimeMs: 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: DEFAULT_CONFIG.defaultModel
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
    activeAgents: new Map(),
    getConcurrency: () => concurrency,
    getPendingSpawns: () => 0,
    lastTaskDeps: new Map(),
    isDepIndexDirty: () => false,
    setDepIndexDirty: vi.fn(),
    setConcurrency: vi.fn(),
    processQueuedTask: vi.fn().mockResolvedValue(undefined),
    drainFailureCounts: new Map<string, number>(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    taskStateService: makeTaskStateService(repo),
    emitDrainPaused: vi.fn(),
    drainPausedUntil: undefined,
    recentlyProcessedTaskIds: new Set<string>(),
    ...overrides
  }
}

describe('validateDrainPreconditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when shutting down', async () => {
    const deps = makeDeps({ isShuttingDown: () => true })
    expect(await validateDrainPreconditions(deps)).toBe(false)
  })

  it('returns false and logs when circuit is open', async () => {
    const deps = makeDeps({
      isCircuitOpen: () => true,
      circuitOpenUntil: Date.now() + 60_000
    })
    expect(await validateDrainPreconditions(deps)).toBe(false)
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('circuit breaker open'))
  })

  it('returns false and logs when no repositories are configured', async () => {
    vi.mocked(getConfiguredRepos).mockReturnValue([])
    const deps = makeDeps()
    expect(await validateDrainPreconditions(deps)).toBe(false)
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No repositories configured')
    )
    vi.mocked(getConfiguredRepos).mockReturnValue([{ name: 'bde', localPath: '/tmp/bde' }])
  })

  it('returns false and logs when OAuth token is invalid', async () => {
    vi.mocked(checkOAuthToken).mockResolvedValue(false)
    const deps = makeDeps()
    expect(await validateDrainPreconditions(deps)).toBe(false)
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('OAuth token invalid'))
  })

  it('returns true when all preconditions pass', async () => {
    vi.mocked(checkOAuthToken).mockResolvedValue(true)
    const deps = makeDeps()
    expect(await validateDrainPreconditions(deps)).toBe(true)
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
    const result = buildTaskStatusMap(deps)
    expect(refreshDependencyIndex).toHaveBeenCalled()
    expect(result).toBe(statusMap)
  })

  it('rebuilds from scratch when dep index is dirty', () => {
    const repo = makeRepo()
    vi.mocked(repo.getTasksWithDependencies).mockReturnValue([
      { id: 'task-1', status: 'queued', depends_on: null } as any
    ])
    const setDepIndexDirty = vi.fn()
    const deps = makeDeps({ repo, isDepIndexDirty: () => true, setDepIndexDirty })
    const result = buildTaskStatusMap(deps)
    expect(deps.depIndex.rebuild).toHaveBeenCalled()
    expect(setDepIndexDirty).toHaveBeenCalledWith(false)
    expect(result.get('task-1')).toBe('queued')
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

    await drainQueuedTasks(2, taskStatusMap, deps)

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

    await drainQueuedTasks(2, new Map(), deps)

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

    await drainQueuedTasks(2, new Map(), deps)

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
    await runDrain(deps)
    expect(deps.metrics.increment).not.toHaveBeenCalled()
  })

  it('increments drainLoopCount when drain runs', async () => {
    const deps = makeDeps()
    await runDrain(deps)
    expect(deps.metrics.increment).toHaveBeenCalledWith('drainLoopCount')
  })

  it('skips task processing when no slots are available', async () => {
    const concurrency = makeConcurrencyState(1)
    const activeAgents = new Map()
    activeAgents.set('task-existing', {} as any)
    const deps = makeDeps({
      getConcurrency: () => concurrency,
      activeAgents
    })
    await runDrain(deps)
    expect(deps.processQueuedTask).not.toHaveBeenCalled()
  })

  it('records drain duration', async () => {
    const deps = makeDeps()
    await runDrain(deps)
    expect(deps.metrics.setLastDrainDuration).toHaveBeenCalledWith(expect.any(Number))
  })

  it('short-circuits when drainPausedUntil is in the future', async () => {
    const deps = makeDeps({ drainPausedUntil: Date.now() + 60_000 })
    await runDrain(deps)
    expect(deps.metrics.increment).not.toHaveBeenCalled()
    expect(deps.processQueuedTask).not.toHaveBeenCalled()
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

    const drainPromise = drainQueuedTasks(2, new Map(), deps)
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

    await drainQueuedTasks(2, new Map(), deps)

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

    await drainQueuedTasks(1, new Map(), deps)

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
      .mockRejectedValue(new Error('credential unavailable for bde repo'))
    const deps = makeDeps({ repo, processQueuedTask })

    await drainQueuedTasks(1, new Map(), deps)

    const [, patch] = vi.mocked(repo.updateTask).mock.calls[0]
    expect(patch.status).toBe('queued')
    expect(patch.failure_reason).toBe('environmental')
    expect(patch.notes).toMatch(/credential unavailable/i)
  })

  it('still errors the task on spec-level (non-environmental) failure', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-spec' }] as any)
    vi.mocked(repo.getTask).mockReturnValue({ id: 'task-spec', status: 'active' } as any)
    const emitDrainPaused = vi.fn()
    const processQueuedTask = vi
      .fn()
      .mockRejectedValue(new Error('TypeError: foo is not a function'))
    // Pre-set failure count so the third failure trips the quarantine threshold in a single drain.
    const drainFailureCounts = new Map<string, number>([['task-spec', 2]])
    const deps = makeDeps({ repo, processQueuedTask, emitDrainPaused, drainFailureCounts })

    await drainQueuedTasks(1, new Map(), deps)

    const updateCalls = vi.mocked(repo.updateTask).mock.calls
    expect(updateCalls.length).toBe(1)
    const [, patch] = updateCalls[0]
    expect(patch.status).toBe('error')
    expect(emitDrainPaused).not.toHaveBeenCalled()
  })

  it('does not pause when the failure classifier returns a non-environmental category', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([{ id: 'task-spec' }] as any)
    const emitDrainPaused = vi.fn()
    const processQueuedTask = vi.fn().mockRejectedValue(new Error('Syntax error in spec'))
    const deps = makeDeps({ repo, processQueuedTask, emitDrainPaused })

    await drainQueuedTasks(1, new Map(), deps)

    expect(emitDrainPaused).not.toHaveBeenCalled()
    // First spec-level failure shouldn't update the task (count < threshold).
    expect(vi.mocked(repo.updateTask)).not.toHaveBeenCalled()
  })
})
