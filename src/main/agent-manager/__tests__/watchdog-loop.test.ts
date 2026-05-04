import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ActiveAgent } from '../types'
import { DEFAULT_CONFIG as _DEFAULT_CONFIG, DEFAULT_MODEL } from '../types'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

vi.mock('../watchdog', () => ({
  checkAgent: vi.fn()
}))
vi.mock('../watchdog-handler', () => ({
  handleWatchdogVerdict: vi.fn()
}))
vi.mock('../../../shared/time', () => ({
  nowIso: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z')
}))
vi.mock('../../agent-event-mapper', () => ({
  flushAgentEventBatcher: vi.fn()
}))
vi.mock('../../data/sqlite-retry', () => ({
  withRetryAsync: vi.fn(async (fn: () => unknown) => fn())
}))

import {
  killActiveAgent,
  runWatchdog,
  killAgentWithEscalation,
  forceKillAgent,
  FORCE_KILL_DELAY_MS,
  type WatchdogLoopDeps
} from '../watchdog-loop'
import { SpawnRegistry } from '../spawn-registry'
import { checkAgent } from '../watchdog'
import { handleWatchdogVerdict } from '../watchdog-handler'
import { flushAgentEventBatcher } from '../../agent-event-mapper'
import { makeConcurrencyState } from '../concurrency'
import type { AgentManagerConfig } from '../types'

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees',
  maxRuntimeMs: 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: DEFAULT_MODEL
}

function makeAgent(taskId: string): ActiveAgent {
  return {
    taskId,
    agentRunId: `run-${taskId}`,
    handle: { abort: vi.fn(), messages: (async function* () {})(), sessionId: 's', steer: vi.fn() },
    model: DEFAULT_MODEL,
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
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
}

function makeMetrics() {
  return {
    recordWatchdogVerdict: vi.fn(),
    increment: vi.fn(),
    setLastDrainDuration: vi.fn()
  }
}

function makeDepsWithRegistry(
  spawnRegistry: SpawnRegistry,
  overrides: Partial<WatchdogLoopDeps> = {}
): WatchdogLoopDeps {
  const concurrency = makeConcurrencyState(2)
  return {
    config: baseConfig,
    repo: makeRepo(),
    metrics: makeMetrics() as any,
    logger: makeLogger(),
    spawnRegistry,
    getConcurrency: () => concurrency,
    setConcurrency: vi.fn(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

function registryWith(...agents: ActiveAgent[]): SpawnRegistry {
  const registry = new SpawnRegistry()
  for (const agent of agents) registry.registerAgent(agent)
  return registry
}

function makeDeps(overrides: Partial<WatchdogLoopDeps> = {}): WatchdogLoopDeps {
  return makeDepsWithRegistry(new SpawnRegistry(), overrides)
}

describe('forceKillAgent', () => {
  it('logs the soft-kill-timeout escalation line and prefers handle.forceKill when available', () => {
    const agent = makeAgent('task-fk')
    const forceKill = vi.fn()
    agent.handle.forceKill = forceKill
    const logger = makeLogger()

    forceKillAgent(agent, logger)

    expect(forceKill).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('forceKill applied after soft kill timeout')
    )
  })

  it('falls back to subprocess SIGKILL when handle.forceKill is not implemented', () => {
    const agent = makeAgent('task-fk2')
    const procKill = vi.fn()
    agent.handle = { ...agent.handle, process: { kill: procKill } as unknown as import('child_process').ChildProcess }
    const logger = makeLogger()

    forceKillAgent(agent, logger)

    expect(procKill).toHaveBeenCalledWith('SIGKILL')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('forceKill applied after soft kill timeout')
    )
  })

  it('falls back to abort() when neither forceKill nor a subprocess is exposed', () => {
    const agent = makeAgent('task-fk3')
    const logger = makeLogger()

    forceKillAgent(agent, logger)

    expect(agent.handle.abort).toHaveBeenCalled()
  })
})

describe('killAgentWithEscalation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('soft-kills immediately and escalates to forceKill after the grace window', () => {
    const agent = makeAgent('task-esc')
    const forceKill = vi.fn()
    agent.handle.forceKill = forceKill
    const registry = new SpawnRegistry()
    registry.registerAgent(agent)
    const logger = makeLogger()

    killAgentWithEscalation(agent, registry, logger)

    expect(agent.handle.abort).toHaveBeenCalledTimes(1)
    expect(forceKill).not.toHaveBeenCalled()

    vi.advanceTimersByTime(FORCE_KILL_DELAY_MS)

    expect(forceKill).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('forceKill applied after soft kill timeout')
    )
  })

  it('skips the forced kill if the agent has already been removed from the registry', () => {
    const agent = makeAgent('task-esc-gone')
    const forceKill = vi.fn()
    agent.handle.forceKill = forceKill
    const registry = new SpawnRegistry() // agent never registered — simulates already-removed
    const logger = makeLogger()

    killAgentWithEscalation(agent, registry, logger)

    vi.advanceTimersByTime(FORCE_KILL_DELAY_MS)

    expect(forceKill).not.toHaveBeenCalled()
  })
})

describe('killActiveAgent', () => {
  it('aborts the agent handle and removes it from the registry', () => {
    const agent = makeAgent('task-1')
    const registry = registryWith(agent)
    const logger = makeLogger()

    killActiveAgent(agent, registry, logger)

    expect(agent.handle.abort).toHaveBeenCalled()
    expect(registry.getAgent('task-1')).toBeUndefined()
  })

  it('logs a warning when abort throws', () => {
    const agent = makeAgent('task-1')
    vi.mocked(agent.handle.abort).mockImplementation(() => {
      throw new Error('abort failed')
    })
    const registry = registryWith(agent)
    const logger = makeLogger()

    killActiveAgent(agent, registry, logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to abort agent'))
    expect(registry.getAgent('task-1')).toBeUndefined()
  })
})

describe('runWatchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when no agents are active', async () => {
    const deps = makeDeps()
    vi.mocked(checkAgent).mockReturnValue('ok')
    await runWatchdog(deps)
    expect(deps.repo.updateTask).not.toHaveBeenCalled()
  })

  it('skips agents that are in processingTasks', async () => {
    const agent = makeAgent('task-1')
    const registry = registryWith(agent)
    registry.markProcessing('task-1')
    const deps = makeDepsWithRegistry(registry)
    vi.mocked(checkAgent).mockReturnValue('idle')
    await runWatchdog(deps)
    expect(deps.repo.updateTask).not.toHaveBeenCalled()
  })

  it('kills agent and updates task when verdict is not ok', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: true,
      terminalStatus: 'error'
    })

    await runWatchdog(deps)

    expect(agent.handle.abort).toHaveBeenCalled()
    expect(deps.repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })

  it('routes status write through taskStateService.transition when provided', async () => {
    const agent = makeAgent('task-ts')
    const concurrency = makeConcurrencyState(2)
    const taskStateService = { transition: vi.fn().mockResolvedValue({ committed: true, dependentsResolved: true }) }
    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency,
      taskStateService: taskStateService as any
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: true,
      terminalStatus: 'error'
    })

    await runWatchdog(deps)

    expect(taskStateService.transition).toHaveBeenCalledWith(
      'task-ts',
      'error',
      expect.objectContaining({ caller: 'watchdog' })
    )
    // raw repo.updateTask must NOT be called when taskStateService is present
    expect(deps.repo.updateTask).not.toHaveBeenCalled()
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-ts', 'error')
  })

  it('records rate-limit-loop verdict and increments retriesQueued', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency
    })
    vi.mocked(checkAgent).mockReturnValue('rate-limit-loop')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: { status: 'queued', claimed_by: null, notes: 're-queued' },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    expect(deps.metrics.recordWatchdogVerdict).toHaveBeenCalledWith('rate-limit-loop')
    expect(deps.metrics.increment).toHaveBeenCalledWith('retriesQueued')
  })

  it('does not call onTaskTerminal when shouldNotifyTerminal is false', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency
    })
    vi.mocked(checkAgent).mockReturnValue('rate-limit-loop')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: { status: 'queued', claimed_by: null, notes: 're-queued' },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    expect(deps.onTaskTerminal).not.toHaveBeenCalled()
  })

  it('flushes agent events before updating task status', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const repo = makeRepo()
    const callOrder: string[] = []
    vi.mocked(flushAgentEventBatcher).mockImplementation(() => callOrder.push('flush'))
    vi.mocked(repo.updateTask).mockImplementation(() => {
      callOrder.push('updateTask')
      return undefined as any
    })
    const deps = makeDepsWithRegistry(registryWith(agent), {
      repo,
      getConcurrency: () => concurrency
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: true,
      terminalStatus: 'error'
    })

    await runWatchdog(deps)

    expect(callOrder.indexOf('flush')).toBeLessThan(callOrder.indexOf('updateTask'))
  })

  it('flushes agent events before calling onTaskTerminal', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const callOrder: string[] = []
    vi.mocked(flushAgentEventBatcher).mockImplementation(() => callOrder.push('flush'))
    const onTaskTerminal = vi.fn().mockImplementation(() => {
      callOrder.push('onTaskTerminal')
      return Promise.resolve()
    })
    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency,
      onTaskTerminal
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: true,
      terminalStatus: 'error'
    })

    await runWatchdog(deps)

    const lastFlushIndex = callOrder.lastIndexOf('flush')
    const onTaskTerminalIndex = callOrder.indexOf('onTaskTerminal')
    expect(lastFlushIndex).toBeLessThan(onTaskTerminalIndex)
  })

  it('logs a warning when updateTask throws', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const repo = makeRepo()
    vi.mocked(repo.updateTask).mockImplementation(() => {
      throw new Error('DB error')
    })
    const deps = makeDepsWithRegistry(registryWith(agent), {
      repo,
      getConcurrency: () => concurrency
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await expect(runWatchdog(deps)).resolves.not.toThrow()
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to update task'))
  })

  it('worktree cleanup runs AFTER the DB write succeeds (T-1: no orphan window)', async () => {
    const agent = makeAgent('task-order')
    const concurrency = makeConcurrencyState(2)
    const callOrder: string[] = []
    const repo = makeRepo()
    vi.mocked(repo.updateTask).mockImplementation(() => {
      callOrder.push('updateTask')
      return undefined as any
    })
    const cleanupAgentWorktree = vi.fn().mockImplementation(() => {
      callOrder.push('cleanup')
      return Promise.resolve()
    })
    const deps = makeDepsWithRegistry(registryWith(agent), {
      repo,
      getConcurrency: () => concurrency,
      cleanupAgentWorktree
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: false
      },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    expect(callOrder.indexOf('updateTask')).toBeLessThan(callOrder.indexOf('cleanup'))
  })

  it('worktree cleanup is skipped when the DB write fails (T-1: no orphan window)', async () => {
    const agent = makeAgent('task-dbfail')
    const concurrency = makeConcurrencyState(2)
    const repo = makeRepo()
    vi.mocked(repo.updateTask).mockImplementation(() => {
      throw new Error('DB error')
    })
    const cleanupAgentWorktree = vi.fn().mockResolvedValue(undefined)
    const deps = makeDepsWithRegistry(registryWith(agent), {
      repo,
      getConcurrency: () => concurrency,
      cleanupAgentWorktree
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: false
      },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    // Worktree must be left intact when the DB write fails so the task can be recovered
    expect(cleanupAgentWorktree).not.toHaveBeenCalled()
  })

  it('skips terminal notify and logs debug when orphan recovery wins the race (EP-5 T-29)', async () => {
    const agent = makeAgent('task-orphan')
    const concurrency = makeConcurrencyState(2)
    const registry = registryWith(agent)
    const deps = makeDepsWithRegistry(registry, { getConcurrency: () => concurrency })

    // Simulate orphan recovery replacing the agent between the collection loop
    // and the kill loop: checkAgent fires during collection (agent is still
    // present with agentRunId 'run-task-orphan'), then during the kill loop
    // the registry entry has been replaced with a newer run.
    vi.mocked(checkAgent).mockImplementation(() => {
      // Replace the registry entry with a newer run, as orphan recovery would do
      registry.registerAgent({ ...agent, agentRunId: 'run-newer' })
      return 'idle'
    })
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: { status: 'error', completed_at: '2026-01-01T00:00:00.000Z', claimed_by: null, notes: 'idle', needs_review: true },
      concurrency,
      shouldNotifyTerminal: true,
      terminalStatus: 'error'
    })

    await runWatchdog(deps)

    // Terminal notify must NOT be called — orphan recovery already owns this slot
    expect(deps.onTaskTerminal).not.toHaveBeenCalled()
    expect(deps.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('already removed — skipping terminal notify')
    )
  })
})

// ── T-16: isTaskStatus guard before taskUpdate.status casts ─────────────────

describe('runWatchdog — T-16: invalid status in taskUpdate is rejected', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls taskStateService.transition with a valid TaskStatus', async () => {
    const agent = makeAgent('task-valid-status')
    const concurrency = makeConcurrencyState(2)
    const taskStateService = { transition: vi.fn().mockResolvedValue({ committed: true }) }
    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency,
      taskStateService: taskStateService as any
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: true,
      terminalStatus: 'error'
    })

    await runWatchdog(deps)

    expect(taskStateService.transition).toHaveBeenCalledWith(
      'task-valid-status',
      'error',
      expect.objectContaining({ caller: 'watchdog' })
    )
  })

  it('skips taskStateService.transition and logs a warning when status is invalid', async () => {
    const agent = makeAgent('task-garbage-status')
    const concurrency = makeConcurrencyState(2)
    const taskStateService = { transition: vi.fn().mockResolvedValue({ committed: true }) }
    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency,
      taskStateService: taskStateService as any
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'garbage',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle'
      },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    expect(taskStateService.transition).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognised status')
    )
  })
})

// ── T-38: cleanupWorktreeIfNotInReview review-status guard ──────────────────

describe('cleanupWorktreeIfNotInReview (T-38)', () => {
  // With T-5, the review-status check uses the known targetStatus from
  // result.taskUpdate.status — no DB read. Tests control behavior by
  // setting status in the handleWatchdogVerdict mock return value.

  it('skips cleanup when targetStatus is review', async () => {
    const agent = makeAgent('task-review')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const concurrency = makeConcurrencyState(2)
    const deps = makeDepsWithRegistry(registryWith(agent), {
      cleanupAgentWorktree: cleanup,
      getConcurrency: () => concurrency
    })

    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'review',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    expect(cleanup).not.toHaveBeenCalled()
  })

  it('calls cleanup when targetStatus is NOT review', async () => {
    const agent = makeAgent('task-failed')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const concurrency = makeConcurrencyState(2)
    const deps = makeDepsWithRegistry(registryWith(agent), {
      cleanupAgentWorktree: cleanup,
      getConcurrency: () => concurrency
    })

    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    expect(cleanup).toHaveBeenCalledWith(agent)
  })

  it('does not throw when cleanupAgentWorktree dep is not injected', async () => {
    const agent = makeAgent('task-no-cleanup')
    const concurrency = makeConcurrencyState(2)
    const deps = makeDepsWithRegistry(registryWith(agent), { getConcurrency: () => concurrency }) // no cleanupAgentWorktree

    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: { status: 'error', completed_at: '2026-01-01T00:00:00.000Z', claimed_by: null, notes: 'idle', needs_review: true },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await expect(runWatchdog(deps)).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// T-48 · P0 — DB write failure blocks onTaskTerminal, emits broadcastToRenderer warning
// ---------------------------------------------------------------------------

describe('T-48: watchdog DB-write failure blocks onTaskTerminal and broadcasts warning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT call onTaskTerminal when taskStateService.transition throws', async () => {
    const agent = makeAgent('task-db-fail')
    const concurrency = makeConcurrencyState(2)
    const broadcastToRenderer = vi.fn()
    const taskStateService = {
      transition: vi.fn().mockRejectedValue(new Error('SQLITE_BUSY: database is locked'))
    }

    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency,
      taskStateService: taskStateService as any,
      broadcastToRenderer
    })

    vi.mocked(checkAgent).mockReturnValue('idle')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'error',
        completed_at: '2026-01-01T00:00:00.000Z',
        claimed_by: null,
        notes: 'idle',
        needs_review: true
      },
      concurrency,
      shouldNotifyTerminal: true,
      terminalStatus: 'error'
    })

    await runWatchdog(deps)

    // onTaskTerminal must NOT be called — the DB write did not land
    expect(deps.onTaskTerminal).not.toHaveBeenCalled()
    // A warning must be broadcast to the renderer so the operator is informed
    expect(broadcastToRenderer).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({ message: expect.stringContaining('task-db-fail') })
    )
  })
})

// ---------------------------------------------------------------------------
// T-54 · P1 — watchdog taskStateService routes rate-limit requeue as queued
// ---------------------------------------------------------------------------

describe('T-54: watchdog routes rate-limit-loop requeue through taskStateService with queued status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls taskStateService.transition with queued (not error) for rate-limit-loop verdict', async () => {
    const agent = makeAgent('task-rl')
    const concurrency = makeConcurrencyState(2)
    const taskStateService = {
      transition: vi.fn().mockResolvedValue({ committed: true })
    }

    const deps = makeDepsWithRegistry(registryWith(agent), {
      getConcurrency: () => concurrency,
      taskStateService: taskStateService as any
    })

    vi.mocked(checkAgent).mockReturnValue('rate-limit-loop')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      taskUpdate: {
        status: 'queued',
        claimed_by: null,
        notes: 'rate-limit requeue'
      },
      concurrency,
      shouldNotifyTerminal: false,
      terminalStatus: undefined
    })

    await runWatchdog(deps)

    expect(taskStateService.transition).toHaveBeenCalledWith(
      'task-rl',
      'queued',
      expect.objectContaining({ caller: 'watchdog' })
    )
    // Must not transition to error
    const errorCalls = taskStateService.transition.mock.calls.filter(
      (c: unknown[]) => c[1] === 'error'
    )
    expect(errorCalls).toHaveLength(0)
  })
})
