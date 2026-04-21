import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ActiveAgent } from '../types'
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

import { killActiveAgent, runWatchdog, type WatchdogLoopDeps } from '../watchdog-loop'
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
  defaultModel: 'claude-sonnet-4-5'
}

function makeAgent(taskId: string): ActiveAgent {
  return {
    taskId,
    agentRunId: `run-${taskId}`,
    handle: { abort: vi.fn(), messages: (async function* () {})(), sessionId: 's', steer: vi.fn() },
    model: 'claude-sonnet-4-5',
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
    recordWatchdogVerdict: vi.fn(),
    increment: vi.fn(),
    setLastDrainDuration: vi.fn()
  }
}

function makeDeps(overrides: Partial<WatchdogLoopDeps> = {}): WatchdogLoopDeps {
  const concurrency = makeConcurrencyState(2)
  return {
    config: baseConfig,
    repo: makeRepo(),
    metrics: makeMetrics() as any,
    logger: makeLogger(),
    activeAgents: new Map(),
    processingTasks: new Set(),
    getConcurrency: () => concurrency,
    setConcurrency: vi.fn(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('killActiveAgent', () => {
  it('aborts the agent handle and removes it from the map', () => {
    const agent = makeAgent('task-1')
    const activeAgents = new Map([['task-1', agent]])
    const logger = makeLogger()

    killActiveAgent(agent, activeAgents, logger)

    expect(agent.handle.abort).toHaveBeenCalled()
    expect(activeAgents.has('task-1')).toBe(false)
  })

  it('logs a warning when abort throws', () => {
    const agent = makeAgent('task-1')
    vi.mocked(agent.handle.abort).mockImplementation(() => {
      throw new Error('abort failed')
    })
    const activeAgents = new Map([['task-1', agent]])
    const logger = makeLogger()

    killActiveAgent(agent, activeAgents, logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to abort agent'))
    expect(activeAgents.has('task-1')).toBe(false)
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
    const deps = makeDeps({
      activeAgents: new Map([['task-1', agent]]),
      processingTasks: new Set(['task-1'])
    })
    vi.mocked(checkAgent).mockReturnValue('idle')
    await runWatchdog(deps)
    expect(deps.repo.updateTask).not.toHaveBeenCalled()
  })

  it('kills agent and updates task when verdict is not ok', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const deps = makeDeps({
      activeAgents: new Map([['task-1', agent]]),
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

  it('records rate-limit-loop verdict and increments retriesQueued', async () => {
    const agent = makeAgent('task-1')
    const concurrency = makeConcurrencyState(2)
    const deps = makeDeps({
      activeAgents: new Map([['task-1', agent]]),
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
    const deps = makeDeps({
      activeAgents: new Map([['task-1', agent]]),
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
    const deps = makeDeps({
      activeAgents: new Map([['task-1', agent]]),
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
    const deps = makeDeps({
      activeAgents: new Map([['task-1', agent]]),
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
    const deps = makeDeps({
      activeAgents: new Map([['task-1', agent]]),
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
})
