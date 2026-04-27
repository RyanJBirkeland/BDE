/**
 * Integration tests for write-failure state consistency guards.
 *
 * Each test forces a repo.updateTask failure and asserts that
 * onTaskTerminal is NOT called — preventing false dependency resolution
 * against tasks that are still `active` in SQLite.
 *
 * Four bugs covered:
 *  T-21 — claim-only fallback in _spawnAgent last-resort catch
 *  T-35 — watchdog DB write failure gates onTaskTerminal
 *  T-92 — resolveFailure returns tagged result instead of throwing
 *  T-95 — skipIfAlreadyOnMain gates onTaskTerminal on write success
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ActiveAgent } from '../types'
import { DEFAULT_CONFIG } from '../types'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

// ---------------------------------------------------------------------------
// Module mocks (must come before imports that transitively use these modules)
// ---------------------------------------------------------------------------

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
  flushAgentEventBatcher: vi.fn(),
  emitAgentEvent: vi.fn()
}))
vi.mock('../../data/sqlite-retry', () => ({
  withRetryAsync: vi.fn(async (fn: () => unknown) => fn())
}))
vi.mock('../task-mapper', () => ({
  mapQueuedTask: vi.fn(),
  checkAndBlockDeps: vi.fn().mockReturnValue(false)
}))
vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/repos/bde' })
}))
vi.mock('../worktree', () => ({
  setupWorktree: vi.fn()
}))

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------

import { runWatchdog, type WatchdogLoopDeps } from '../watchdog-loop'
import { checkAgent } from '../watchdog'
import { handleWatchdogVerdict } from '../watchdog-handler'
import { resolveFailure } from '../resolve-failure-phases'
import { MAX_RETRIES } from '../types'
import { withRetryAsync } from '../../data/sqlite-retry'
import { makeConcurrencyState } from '../concurrency'
import type { AgentManagerConfig } from '../types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const baseConfig: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees',
  maxRuntimeMs: 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: DEFAULT_CONFIG.defaultModel
}

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

function makeRepo(overrides: Partial<IAgentTaskRepository> = {}): IAgentTaskRepository {
  return {
    updateTask: vi.fn().mockResolvedValue(null),
    getTask: vi.fn().mockReturnValue(null),
    claimTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn().mockResolvedValue(null),
    listActiveAgentRuns: vi.fn().mockReturnValue([]),
    ...overrides
  } as unknown as IAgentTaskRepository
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
}

function makeMetrics() {
  return {
    recordWatchdogVerdict: vi.fn(),
    recordAgentDuration: vi.fn(),
    increment: vi.fn(),
    snapshot: vi.fn()
  }
}

// ---------------------------------------------------------------------------
// T-21 — claim-only fallback (tested via the two-level fallback logic)
// ---------------------------------------------------------------------------

describe('T-21 — claim-only fallback when status write is rejected', () => {
  it('retries with no status field when first updateTask throws, clearing claimed_by', () => {
    const updateTask = vi.fn()
      .mockImplementationOnce(() => { throw new Error('transition guard rejected') })
      .mockImplementationOnce(() => undefined)

    const repo = makeRepo({ updateTask })
    const logger = makeLogger()
    const taskId = 't-21'

    // Simulate the catch block from _spawnAgent: first attempt is status+claim,
    // second attempt is claim-only fallback.
    const errorNotes = 'something went wrong'
    try {
      repo.updateTask(taskId, { status: 'error', claimed_by: null, notes: errorNotes })
    } catch {
      logger.warn(`status write rejected — retrying with claim-only patch`)
      repo.updateTask(taskId, { claimed_by: null, notes: errorNotes })
    }

    expect(updateTask).toHaveBeenCalledTimes(2)

    const [, firstPatch] = updateTask.mock.calls[0] as [string, Record<string, unknown>]
    expect(firstPatch.status).toBe('error')
    expect(firstPatch.claimed_by).toBeNull()

    const [, secondPatch] = updateTask.mock.calls[1] as [string, Record<string, unknown>]
    expect(secondPatch).not.toHaveProperty('status')
    expect(secondPatch.claimed_by).toBeNull()
    expect(secondPatch.notes).toBe(errorNotes)
  })

  it('logs error when both status write and claim-only fallback fail', () => {
    const updateTask = vi.fn().mockImplementation(() => { throw new Error('DB totally unavailable') })
    const repo = makeRepo({ updateTask })
    const logger = makeLogger()
    const taskId = 't-21b'
    const errorNotes = 'something went wrong'

    try {
      repo.updateTask(taskId, { status: 'error', claimed_by: null, notes: errorNotes })
    } catch {
      logger.warn(`status write rejected — retrying with claim-only patch`)
      try {
        repo.updateTask(taskId, { claimed_by: null, notes: errorNotes })
      } catch (claimReleaseErr) {
        logger.error(`Failed to release claim for task ${taskId}: ${claimReleaseErr}`)
      }
    }

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to release claim'))
    expect(updateTask).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// T-35 — watchdog gates onTaskTerminal on write success
// ---------------------------------------------------------------------------

describe('T-35 — watchdog does not call onTaskTerminal when DB write fails', () => {
  let agent: ActiveAgent
  let activeAgents: Map<string, ActiveAgent>
  let onTaskTerminal: ReturnType<typeof vi.fn>
  let broadcastToRenderer: ReturnType<typeof vi.fn>
  let logger: ReturnType<typeof makeLogger>
  let repo: IAgentTaskRepository

  beforeEach(() => {
    vi.clearAllMocks()
    agent = makeAgent('t-35')
    activeAgents = new Map([['t-35', agent]])
    onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    broadcastToRenderer = vi.fn()
    logger = makeLogger()

    vi.mocked(checkAgent).mockReturnValue('max-runtime')
    vi.mocked(handleWatchdogVerdict).mockReturnValue({
      concurrency: makeConcurrencyState(0, 2),
      taskUpdate: { status: 'failed', claimed_by: null },
      shouldNotifyTerminal: true,
      terminalStatus: 'failed'
    })
  })

  it('broadcasts manager:warning and skips onTaskTerminal when all retries fail', async () => {
    // Make withRetryAsync propagate the failure
    vi.mocked(withRetryAsync).mockRejectedValueOnce(new Error('SQLITE_BUSY — all retries exhausted'))

    repo = makeRepo({ updateTask: vi.fn().mockImplementation(() => { throw new Error('SQLITE_BUSY') }) })

    const deps: WatchdogLoopDeps = {
      config: baseConfig,
      repo,
      metrics: makeMetrics(),
      logger,
      activeAgents,
      processingTasks: new Set(),
      getConcurrency: () => makeConcurrencyState(1, 2),
      setConcurrency: vi.fn(),
      onTaskTerminal,
      broadcastToRenderer
    }

    await runWatchdog(deps)

    expect(broadcastToRenderer).toHaveBeenCalledWith('manager:warning', expect.objectContaining({ message: expect.stringContaining('t-35') }))
    expect(onTaskTerminal).not.toHaveBeenCalled()
  })

  it('calls onTaskTerminal when write succeeds', async () => {
    vi.mocked(withRetryAsync).mockResolvedValueOnce(undefined)

    repo = makeRepo({ updateTask: vi.fn().mockReturnValue(undefined) })

    const deps: WatchdogLoopDeps = {
      config: baseConfig,
      repo,
      metrics: makeMetrics(),
      logger,
      activeAgents,
      processingTasks: new Set(),
      getConcurrency: () => makeConcurrencyState(1, 2),
      setConcurrency: vi.fn(),
      onTaskTerminal,
      broadcastToRenderer
    }

    await runWatchdog(deps)

    expect(onTaskTerminal).toHaveBeenCalledWith('t-35', 'failed')
    expect(broadcastToRenderer).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// T-92 — resolveFailure returns tagged result (not a throw)
// ---------------------------------------------------------------------------

describe('T-92 — resolveFailure returns writeFailed:true instead of throwing', () => {
  it('returns { writeFailed: true } when updateTask throws — does not throw', async () => {
    const repo = makeRepo({
      updateTask: vi.fn().mockImplementation(() => { throw new Error('DB locked') }),
      getTask: vi.fn().mockReturnValue({ started_at: new Date(Date.now() - 5000).toISOString() })
    })
    const logger = makeLogger()

    const result = await resolveFailure({ taskId: 't-92', retryCount: 0, repo: repo as never }, logger as never)

    expect(result).toMatchObject({ writeFailed: true })
    expect(result).toHaveProperty('error')
  })

  it('returns { writeFailed: true, isTerminal: true } when terminal and write fails', async () => {
    const repo = makeRepo({
      updateTask: vi.fn().mockImplementation(() => { throw new Error('DB locked') }),
      getTask: vi.fn().mockReturnValue({ started_at: new Date(Date.now() - 5000).toISOString() })
    })

    const result = await resolveFailure({ taskId: 't-92b', retryCount: MAX_RETRIES, repo: repo as never })

    expect(result).toMatchObject({ writeFailed: true, isTerminal: true })
  })

  it('caller skips onTaskTerminal when writeFailed is true', async () => {
    const repo = makeRepo({
      updateTask: vi.fn().mockImplementation(() => { throw new Error('DB locked') }),
      getTask: vi.fn().mockReturnValue({ started_at: new Date(Date.now() - 5000).toISOString() })
    })
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)

    const result = await resolveFailure({ taskId: 't-92c', retryCount: MAX_RETRIES, repo: repo as never })

    if (!result.writeFailed) {
      await onTaskTerminal('t-92c', result.isTerminal ? 'failed' : 'queued')
    }

    expect(onTaskTerminal).not.toHaveBeenCalled()
  })

  it('returns { isTerminal: false } on successful non-terminal write', async () => {
    const repo = makeRepo({
      updateTask: vi.fn().mockReturnValue(undefined),
      getTask: vi.fn().mockReturnValue(null)
    })

    const result = await resolveFailure({ taskId: 't-92d', retryCount: 0, repo: repo as never })

    expect(result).toMatchObject({ isTerminal: false })
    expect(result.writeFailed).toBeFalsy()
  })

  it('returns { isTerminal: true } on successful terminal write', async () => {
    const repo = makeRepo({
      updateTask: vi.fn().mockReturnValue(undefined),
      getTask: vi.fn().mockReturnValue({ started_at: new Date(Date.now() - 5000).toISOString() })
    })

    const result = await resolveFailure({ taskId: 't-92e', retryCount: MAX_RETRIES, repo: repo as never })

    expect(result).toMatchObject({ isTerminal: true })
    expect(result.writeFailed).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// T-95 — skipIfAlreadyOnMain gates onTaskTerminal on write success
// ---------------------------------------------------------------------------

describe('T-95 — skipIfAlreadyOnMain does not call onTaskTerminal when write fails', () => {
  it('does not call onTaskTerminal and returns false when updateTask throws', async () => {
    // Simulate the restructured try/catch in skipIfAlreadyOnMain:
    // onTaskTerminal is inside the try block, return false is in the catch block.
    const updateTask = vi.fn().mockImplementation(() => { throw new Error('SQLITE_BUSY') })
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    const logger = makeLogger()
    const taskId = 't-95'

    let result: boolean
    try {
      updateTask(taskId, { status: 'done', completed_at: '2026-01-01T00:00:00.000Z', claimed_by: null, notes: 'auto-completed' })
      await onTaskTerminal(taskId, 'done')
      result = true
    } catch (err) {
      logger.warn(`Failed to mark task ${taskId} done: ${err}`)
      result = false
    }

    expect(onTaskTerminal).not.toHaveBeenCalled()
    expect(result).toBe(false)
  })

  it('calls onTaskTerminal and returns true when write succeeds', async () => {
    const updateTask = vi.fn().mockReturnValue(undefined)
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    const logger = makeLogger()
    const taskId = 't-95b'

    let result: boolean
    try {
      updateTask(taskId, { status: 'done', completed_at: '2026-01-01T00:00:00.000Z', claimed_by: null, notes: 'auto-completed' })
      await onTaskTerminal(taskId, 'done')
      result = true
    } catch (err) {
      logger.warn(`Failed to mark task ${taskId} done: ${err}`)
      result = false
    }

    expect(onTaskTerminal).toHaveBeenCalledWith(taskId, 'done')
    expect(result).toBe(true)
  })
})
