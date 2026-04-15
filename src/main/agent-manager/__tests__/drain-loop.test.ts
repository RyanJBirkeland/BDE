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
  type DrainLoopDeps
} from '../drain-loop'
import { checkOAuthToken } from '../oauth-checker'
import { refreshDependencyIndex } from '../dependency-refresher'
import { makeConcurrencyState } from '../concurrency'
import type { AgentManagerConfig } from '../types'
import { getConfiguredRepos } from '../../paths'

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees',
  maxRuntimeMs: 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: 'claude-sonnet-4-5'
}

function makeRepo(): IAgentTaskRepository {
  return {
    updateTask: vi.fn(),
    getTask: vi.fn(),
    claimTask: vi.fn(),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn(),
    listActiveAgentRuns: vi.fn().mockReturnValue([])
  } as unknown as IAgentTaskRepository
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function makeMetrics() {
  return {
    increment: vi.fn(),
    setLastDrainDuration: vi.fn(),
    recordWatchdogVerdict: vi.fn()
  }
}

function makeDepIndex(): DependencyIndex {
  return { rebuild: vi.fn(), getBlockedBy: vi.fn(), addEdges: vi.fn() } as unknown as DependencyIndex
}

function makeDeps(overrides: Partial<DrainLoopDeps> = {}): DrainLoopDeps {
  const concurrency = makeConcurrencyState(2)
  return {
    config: baseConfig,
    repo: makeRepo(),
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
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('No repositories configured'))
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
    vi.mocked(repo.getQueuedTasks).mockReturnValue([
      { id: 'task-1' }, { id: 'task-2' }
    ] as any)
    const processQueuedTask = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ repo, processQueuedTask })
    const taskStatusMap = new Map<string, string>()

    await drainQueuedTasks(2, taskStatusMap, deps)

    expect(processQueuedTask).toHaveBeenCalledTimes(2)
  })

  it('stops early when shutting down mid-loop', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([
      { id: 'task-1' }, { id: 'task-2' }
    ] as any)
    let called = 0
    const isShuttingDown = vi.fn().mockImplementation(() => called >= 1)
    const processQueuedTask = vi.fn().mockImplementation(async () => { called++ })
    const deps = makeDeps({ repo, isShuttingDown, processQueuedTask })

    await drainQueuedTasks(2, new Map(), deps)

    expect(processQueuedTask).toHaveBeenCalledTimes(1)
  })

  it('logs errors from individual tasks without aborting the loop', async () => {
    const repo = makeRepo()
    vi.mocked(repo.getQueuedTasks).mockReturnValue([
      { id: 'task-1' }, { id: 'task-2' }
    ] as any)
    const processQueuedTask = vi.fn()
      .mockRejectedValueOnce(new Error('task error'))
      .mockResolvedValueOnce(undefined)
    const deps = makeDeps({ repo, processQueuedTask })

    await drainQueuedTasks(2, new Map(), deps)

    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to process task'))
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
})
