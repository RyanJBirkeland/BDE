/**
 * Tests for createTaskTerminalService (T-13).
 *
 * Covers:
 *   - Batch deduplication: two concurrent calls for the same task ID result
 *     in exactly one resolveDependents invocation
 *   - Multiple tasks batched: multiple different task IDs in one batch all
 *     get resolved
 *   - Retry on failure: if resolveDependents throws on first attempt, retries
 *     after 500ms
 *   - onStatusTerminal skips non-terminal statuses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/resolve-dependents', () => ({
  resolveDependents: vi.fn()
}))

vi.mock('../agent-manager/dependency-refresher', () => ({
  refreshDependencyIndex: vi.fn().mockReturnValue(new Map()),
  computeDepsFingerprint: vi.fn().mockReturnValue('hash')
}))

vi.mock('../lib/async-utils', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
  execFileAsync: vi.fn()
}))

import { createTaskTerminalService } from '../services/task-terminal-service'
import { resolveDependents } from '../lib/resolve-dependents'
import type { TaskTerminalServiceDeps } from '../services/task-terminal-service'
import type { TaskStatus } from '../../shared/task-state-machine'
import { sleep } from '../lib/async-utils'

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn()
  }
}

function makeEpicDepsReader() {
  return {
    getDependentEpics: vi.fn().mockReturnValue(new Set()),
    areEpicDepsSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] })
  }
}

function makeDeps(overrides: Partial<TaskTerminalServiceDeps> = {}): TaskTerminalServiceDeps {
  return {
    getTask: vi.fn().mockReturnValue(null),
    updateTask: vi.fn().mockResolvedValue(null),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
    listGroupTasks: vi.fn().mockReturnValue([]),
    epicDepsReader: makeEpicDepsReader(),
    logger: makeLogger(),
    ...overrides
  }
}

describe('createTaskTerminalService — batch deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('two concurrent calls for the same task ID result in exactly one resolveDependents invocation', async () => {
    vi.mocked(resolveDependents).mockImplementation(() => undefined)
    const service = createTaskTerminalService(makeDeps())

    // Schedule two calls for the same task — BatchedTaskResolver deduplicates via Map.set
    service.onStatusTerminal('task-1', 'done' as TaskStatus)
    service.onStatusTerminal('task-1', 'done' as TaskStatus)

    // Flush the batched setTimeout(0) — both calls landed in the same microtask,
    // so only one entry remains in the pending Map.
    await vi.runAllTimersAsync()

    expect(vi.mocked(resolveDependents)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(resolveDependents).mock.calls[0][0]).toMatchObject({ completedTaskId: 'task-1' })
  })

  it('multiple different task IDs in one batch all get resolved', async () => {
    vi.mocked(resolveDependents).mockImplementation(() => undefined)
    const service = createTaskTerminalService(makeDeps())

    service.onStatusTerminal('task-1', 'done' as TaskStatus)
    service.onStatusTerminal('task-2', 'failed' as TaskStatus)
    service.onStatusTerminal('task-3', 'cancelled' as TaskStatus)

    await vi.runAllTimersAsync()

    const resolvedIds = vi.mocked(resolveDependents).mock.calls.map((call) => (call[0] as { completedTaskId: string }).completedTaskId)
    expect(resolvedIds).toContain('task-1')
    expect(resolvedIds).toContain('task-2')
    expect(resolvedIds).toContain('task-3')
    expect(vi.mocked(resolveDependents)).toHaveBeenCalledTimes(3)
  })
})

describe('createTaskTerminalService — retry on failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries resolveDependents after 500ms when it throws on first attempt', async () => {
    vi.mocked(resolveDependents)
      .mockImplementationOnce(() => { throw new Error('DB locked') })
      .mockImplementationOnce(() => undefined)
    vi.mocked(sleep).mockResolvedValue(undefined)

    const service = createTaskTerminalService(makeDeps())
    service.onStatusTerminal('task-retry', 'done' as TaskStatus)

    // Let the batch timer fire
    await vi.runAllTimersAsync()

    // sleep(500) is called between first and second attempt
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(500)
    // resolveDependents is called twice — first attempt throws, second succeeds
    expect(vi.mocked(resolveDependents)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(resolveDependents).mock.calls[1][0]).toMatchObject({ completedTaskId: 'task-retry' })
  })

  it('logs an error and stops after the retry if it also throws', async () => {
    vi.mocked(resolveDependents).mockImplementation(() => { throw new Error('persistent failure') })
    vi.mocked(sleep).mockResolvedValue(undefined)

    const deps = makeDeps()
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('task-retry-fail', 'done' as TaskStatus)

    await vi.runAllTimersAsync()

    // Two attempts: initial + one retry
    expect(vi.mocked(resolveDependents)).toHaveBeenCalledTimes(2)
    // Error logged for the retry failure
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('retry failed')
    )
  })
})

describe('createTaskTerminalService — onStatusTerminal gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules resolution for terminal statuses (done, failed, cancelled)', async () => {
    vi.mocked(resolveDependents).mockImplementation(() => undefined)
    const service = createTaskTerminalService(makeDeps())

    const terminalStatuses: TaskStatus[] = ['done', 'failed', 'cancelled', 'error']
    for (const status of terminalStatuses) {
      service.onStatusTerminal(`task-${status}`, status)
    }

    await vi.runAllTimersAsync()

    expect(vi.mocked(resolveDependents)).toHaveBeenCalledTimes(terminalStatuses.length)
  })

  it('does not schedule resolution for non-terminal statuses', async () => {
    vi.mocked(resolveDependents).mockImplementation(() => undefined)
    const service = createTaskTerminalService(makeDeps())

    const nonTerminalStatuses: TaskStatus[] = ['queued', 'active', 'blocked', 'review']
    for (const status of nonTerminalStatuses) {
      service.onStatusTerminal('task-non-terminal', status)
    }

    await vi.runAllTimersAsync()

    expect(vi.mocked(resolveDependents)).not.toHaveBeenCalled()
  })
})
