import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ActiveAgent } from '../types'
import { DEFAULT_CONFIG } from '../types'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

vi.mock('../../agent-event-mapper', () => ({
  flushAgentEventBatcher: vi.fn()
}))

import { executeShutdown, type ShutdownCoordinatorDeps } from '../shutdown-coordinator'
import { flushAgentEventBatcher } from '../../agent-event-mapper'
import { SpawnRegistry } from '../spawn-registry'

function makeAgent(taskId: string): ActiveAgent {
  return {
    taskId,
    agentRunId: `run-${taskId}`,
    handle: { abort: vi.fn(), messages: (async function* () {})(), sessionId: 's', steer: vi.fn() },
    model: DEFAULT_CONFIG.defaultModel,
    startedAt: 0,
    lastOutputAt: 0,
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: null,
    maxCostUsd: null,
    worktreePath: `/tmp/worktrees/${taskId}`,
    branch: `agent/${taskId}`
  }
}

function makeRepo(): IAgentTaskRepository {
  return {
    updateTask: vi.fn().mockResolvedValue(null),
    getTask: vi.fn(),
    claimTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn().mockResolvedValue(null),
    listActiveAgentRuns: vi.fn().mockReturnValue([])
  } as unknown as IAgentTaskRepository
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function registryWith(...agents: ActiveAgent[]): SpawnRegistry {
  const registry = new SpawnRegistry()
  for (const agent of agents) registry.registerAgent(agent)
  return registry
}

function registryWithPromise(p: Promise<void>): SpawnRegistry {
  const registry = new SpawnRegistry()
  registry.trackPromise(p)
  return registry
}

function makeDeps(
  spawnRegistry: SpawnRegistry = new SpawnRegistry(),
  overrides: Partial<Omit<ShutdownCoordinatorDeps, 'spawnRegistry'>> = {}
): ShutdownCoordinatorDeps {
  return {
    repo: makeRepo(),
    logger: makeLogger(),
    spawnRegistry,
    drainInFlight: null,
    ...overrides
  }
}

describe('executeShutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes with no active agents', async () => {
    const deps = makeDeps()
    await expect(executeShutdown(deps, 1000)).resolves.toBeUndefined()
    expect(flushAgentEventBatcher).toHaveBeenCalled()
  })

  it('waits for drainInFlight before aborting agents', async () => {
    const order: string[] = []
    let resolveDrain!: () => void
    const drainInFlight = new Promise<void>((r) => {
      resolveDrain = r
    }).then(() => {
      order.push('drain')
    })

    const agent = makeAgent('task-1')
    vi.mocked(agent.handle.abort).mockImplementation(() => {
      order.push('abort')
    })

    const deps = makeDeps(registryWith(agent), { drainInFlight })

    const shutdownPromise = executeShutdown(deps, 100)
    resolveDrain()
    await shutdownPromise

    expect(order[0]).toBe('drain')
    expect(order[1]).toBe('abort')
  })

  it('aborts all active agents', async () => {
    const agent1 = makeAgent('task-1')
    const agent2 = makeAgent('task-2')
    const deps = makeDeps(registryWith(agent1, agent2))

    await executeShutdown(deps, 100)

    expect(agent1.handle.abort).toHaveBeenCalled()
    expect(agent2.handle.abort).toHaveBeenCalled()
  })

  it('logs a warning when abort throws but continues', async () => {
    const agent = makeAgent('task-1')
    vi.mocked(agent.handle.abort).mockImplementation(() => {
      throw new Error('abort failed')
    })
    const deps = makeDeps(registryWith(agent))

    await expect(executeShutdown(deps, 100)).resolves.toBeUndefined()
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to abort agent'))
  })

  it('re-queues active tasks after shutdown', async () => {
    const agent = makeAgent('task-1')
    const deps = makeDeps(registryWith(agent))

    await executeShutdown(deps, 100)

    expect(deps.repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'queued',
        claimed_by: null,
        notes: expect.stringContaining('re-queued due to BDE shutdown')
      })
    )
    expect(deps.logger.info).toHaveBeenCalledWith(expect.stringContaining('Re-queued task task-1'))
  })

  it('clears active registry entries after re-queuing', async () => {
    const agent = makeAgent('task-1')
    const registry = registryWith(agent)
    const deps = makeDeps(registry)

    await executeShutdown(deps, 100)

    expect(registry.hasActiveAgent('task-1')).toBe(false)
  })

  it('logs a warning when re-queue updateTask throws', async () => {
    const agent = makeAgent('task-1')
    const repo = makeRepo()
    vi.mocked(repo.updateTask).mockImplementation(() => {
      throw new Error('DB error')
    })
    const deps = makeDeps(registryWith(agent), { repo })

    await expect(executeShutdown(deps, 100)).resolves.toBeUndefined()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to re-queue task')
    )
  })

  it('waits for agentPromises to settle', async () => {
    const settled: string[] = []
    const p = new Promise<void>((r) => setTimeout(r, 10)).then(() => {
      settled.push('agent-done')
    })
    const deps = makeDeps(registryWithPromise(p))

    await executeShutdown(deps, 500)
    expect(settled).toContain('agent-done')
  })

  it('flushes agent event batcher at the end', async () => {
    const deps = makeDeps()
    await executeShutdown(deps, 100)
    expect(flushAgentEventBatcher).toHaveBeenCalledTimes(1)
  })

  it('continues when drainInFlight rejects', async () => {
    const drainInFlight = Promise.reject(new Error('drain failed'))
    const deps = makeDeps(new SpawnRegistry(), { drainInFlight })

    await expect(executeShutdown(deps, 100)).resolves.toBeUndefined()
  })

  it('skips re-queue for tasks already in review status', async () => {
    const agent = makeAgent('task-review')
    const repo = makeRepo()
    vi.mocked(repo.getTask).mockReturnValue({ id: 'task-review', status: 'review' } as any)
    const deps = makeDeps(registryWith(agent), { repo })

    await executeShutdown(deps, 100)

    expect(repo.updateTask).not.toHaveBeenCalledWith('task-review', expect.anything())
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping re-queue for review task task-review')
    )
  })

  it('re-queues active tasks but not review tasks in a mixed shutdown', async () => {
    const activeAgent = makeAgent('task-active')
    const reviewAgent = makeAgent('task-review')
    const repo = makeRepo()
    vi.mocked(repo.getTask).mockImplementation((id) => {
      if (id === 'task-review') return { id: 'task-review', status: 'review' } as any
      return { id: 'task-active', status: 'active' } as any
    })
    const deps = makeDeps(registryWith(activeAgent, reviewAgent), { repo })

    await executeShutdown(deps, 100)

    expect(repo.updateTask).toHaveBeenCalledWith(
      'task-active',
      expect.objectContaining({ status: 'queued' })
    )
    expect(repo.updateTask).not.toHaveBeenCalledWith('task-review', expect.anything())
  })
})
