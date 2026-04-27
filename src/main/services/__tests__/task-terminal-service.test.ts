import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTaskTerminalService } from '../task-terminal-service'
import type { TaskTerminalServiceDeps } from '../task-terminal-service'

// Controllable mock for resolveDependents — used in the consolidated error test
const mockResolveDependents = vi.fn()
vi.mock('../../lib/resolve-dependents', () => ({
  resolveDependents: (...args: unknown[]) => mockResolveDependents(...args)
}))

// Controllable mock for refreshDependencyIndex — used to trigger the outer catch
const mockRefreshDependencyIndex = vi.fn()
vi.mock('../../agent-manager/dependency-refresher', () => ({
  refreshDependencyIndex: (...args: unknown[]) => mockRefreshDependencyIndex(...args),
  computeDepsFingerprint: vi.fn().mockReturnValue({ hash: 'x', deps: null })
}))

function makeDeps(overrides: Partial<TaskTerminalServiceDeps> = {}): TaskTerminalServiceDeps {
  return {
    getTask: vi.fn().mockReturnValue({
      id: 't1',
      title: 'Test Task',
      status: 'done',
      depends_on: null,
      notes: null,
      group_id: null
    }),
    updateTask: vi.fn(),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
    listGroupTasks: vi.fn().mockReturnValue([]),
    epicDepsReader: {
      getDependentEpics: vi.fn().mockReturnValue(new Set()),
      areEpicDepsSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] })
    },
    getSetting: vi.fn().mockReturnValue(null),
    broadcast: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides
  }
}

describe('createTaskTerminalService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default: resolveDependents succeeds (no-op); individual tests can override
    mockResolveDependents.mockReset()
    // Default: refreshDependencyIndex is a no-op; tests that need it to throw override
    mockRefreshDependencyIndex.mockReset().mockReturnValue(new Map())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls resolveDependents when task reaches terminal status', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi
        .fn()
        .mockReturnValue([{ id: 't2', depends_on: [{ id: 't1', type: 'hard' }] }])
    })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    // Resolution is deferred via setTimeout(0)
    expect(mockResolveDependents).not.toHaveBeenCalled()

    vi.runAllTimers()

    // resolveDependents should have been called for t1
    expect(mockResolveDependents).toHaveBeenCalledWith(
      't1',
      'done',
      expect.anything(), // depIndex
      deps.getTask,
      deps.updateTask,
      deps.logger,
      deps.getSetting,
      expect.anything(), // epicIndex
      deps.getGroup,
      deps.listGroupTasks,
      undefined, // runInTransaction (not provided by default)
      undefined, // onTaskTerminal
      undefined  // taskStateService
    )
  })

  it('does nothing for non-terminal statuses', () => {
    const deps = makeDeps()
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'active')

    vi.runAllTimers()

    expect(deps.getTasksWithDependencies).not.toHaveBeenCalled()
  })

  it('swallows errors and does not throw when dep-index refresh fails', () => {
    mockRefreshDependencyIndex.mockImplementationOnce(() => {
      throw new Error('db boom')
    })
    const deps = makeDeps()
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    // The outer catch logs with error and calls broadcast — must not throw
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('refreshTaskDepIndex failed')
    )
  })

  it('calls injected broadcast when dep-index refresh throws', () => {
    mockRefreshDependencyIndex.mockImplementationOnce(() => {
      throw new Error('index failure')
    })
    const broadcastFn = vi.fn()
    const deps = makeDeps({ broadcast: broadcastFn })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    vi.runAllTimers()

    expect(broadcastFn).toHaveBeenCalledWith(
      'task-terminal:resolution-error',
      expect.objectContaining({ error: expect.stringContaining('index failure') })
    )
  })

  it('does not throw when broadcast dep is absent and refresh throws', () => {
    mockRefreshDependencyIndex.mockImplementationOnce(() => {
      throw new Error('no broadcaster')
    })
    const deps = makeDeps({ broadcast: undefined })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    expect(() => vi.runAllTimers()).not.toThrow()
  })

  it('debounces multiple concurrent terminal events into one resolution pass', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockReturnValue([
        { id: 't1', depends_on: null },
        { id: 't2', depends_on: null },
        { id: 't3', depends_on: null },
        { id: 't4', depends_on: null },
        { id: 't5', depends_on: null }
      ]),
      getTask: vi.fn().mockImplementation((id: string) => ({
        id,
        title: `Task ${id}`,
        status: 'done',
        depends_on: null,
        notes: null
      }))
    })
    const service = createTaskTerminalService(deps)

    // 5 synchronous terminal events
    service.onStatusTerminal('t1', 'done')
    service.onStatusTerminal('t2', 'done')
    service.onStatusTerminal('t3', 'failed')
    service.onStatusTerminal('t4', 'cancelled')
    service.onStatusTerminal('t5', 'error')

    // rebuildIndex should not be called yet
    expect(mockRefreshDependencyIndex).not.toHaveBeenCalled()

    // Advance timers to flush setTimeout(0)
    vi.runAllTimers()

    // rebuildIndex should be called exactly once (not 5 times)
    expect(mockRefreshDependencyIndex).toHaveBeenCalledTimes(1)
  })

  it('resolves each unique task exactly once when called multiple times with same id', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi
        .fn()
        .mockReturnValue([{ id: 't2', depends_on: [{ id: 't1', type: 'hard' }] }])
    })
    const service = createTaskTerminalService(deps)

    // Call same task 3 times with different statuses (last write wins via Map)
    service.onStatusTerminal('t1', 'done')
    service.onStatusTerminal('t1', 'failed')
    service.onStatusTerminal('t1', 'done')

    vi.runAllTimers()

    // resolveDependents should be called exactly once for t1 (Map deduplicates)
    expect(mockResolveDependents).toHaveBeenCalledTimes(1)
    expect(mockResolveDependents).toHaveBeenCalledWith(
      't1',
      'done', // last status wins
      expect.anything(),
      deps.getTask,
      deps.updateTask,
      deps.logger,
      deps.getSetting,
      expect.anything(),
      deps.getGroup,
      deps.listGroupTasks,
      undefined, // runInTransaction (not provided by default)
      undefined, // onTaskTerminal
      undefined  // taskStateService
    )
  })

  it('passes runInTransaction to resolveDependents when provided', () => {
    const runInTransaction = vi.fn((fn: () => void) => fn())
    const deps = makeDeps({
      getTasksWithDependencies: vi
        .fn()
        .mockReturnValue([{ id: 't2', depends_on: [{ id: 't1', type: 'hard' }] }]),
      runInTransaction
    })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    vi.runAllTimers()

    expect(mockResolveDependents).toHaveBeenCalledWith(
      't1',
      'done',
      expect.anything(), // depIndex
      deps.getTask,
      deps.updateTask,
      deps.logger,
      deps.getSetting,
      expect.anything(), // epicIndex
      deps.getGroup,
      deps.listGroupTasks,
      runInTransaction,
      undefined, // onTaskTerminal
      undefined  // taskStateService
    )
  })

  it('two concurrent onStatusTerminal calls see a consistent cascade snapshot via runInTransaction', () => {
    // Simulate two tasks completing concurrently — both calls should be batched
    // and resolveDependents should be called once per task within the same batch.
    // The runInTransaction wrapper is invoked once per task resolution, ensuring
    // each cascade is atomic even when multiple tasks terminal simultaneously.
    const transactionCalls: string[] = []
    const runInTransaction = vi.fn((fn: () => void) => {
      transactionCalls.push('tx-start')
      fn()
      transactionCalls.push('tx-end')
    })

    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockReturnValue([
        { id: 't1', depends_on: null },
        { id: 't2', depends_on: null }
      ]),
      runInTransaction
    })

    // Capture which taskIds resolveDependents was called with
    const resolvedIds: string[] = []
    mockResolveDependents.mockImplementation((id: string) => {
      resolvedIds.push(id)
    })

    const service = createTaskTerminalService(deps)

    // Two concurrent terminal events — batched by BatchedTaskResolver
    service.onStatusTerminal('t1', 'done')
    service.onStatusTerminal('t2', 'failed')

    // Neither should have been called yet (batched via setTimeout(0))
    expect(resolvedIds).toHaveLength(0)

    vi.runAllTimers()

    // Both tasks should have been resolved
    expect(resolvedIds).toContain('t1')
    expect(resolvedIds).toContain('t2')

    // resolveDependents was called once per task
    expect(mockResolveDependents).toHaveBeenCalledTimes(2)

    // runInTransaction was forwarded to resolveDependents for both calls
    expect(mockResolveDependents).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.anything(),
      deps.getTask,
      deps.updateTask,
      deps.logger,
      deps.getSetting,
      expect.anything(),
      deps.getGroup,
      deps.listGroupTasks,
      runInTransaction,
      undefined, // onTaskTerminal
      undefined  // taskStateService
    )
  })

  // consolidated error log when per-task resolutions fail
  it('logs a consolidated error after the loop when some resolveDependents calls fail', () => {
    // Use the module-level mockResolveDependents to control which resolution throws.
    // Call 1 (for 'ta') throws; call 2 (for 'tb') succeeds.
    let callCount = 0
    mockResolveDependents.mockImplementation((id: string) => {
      callCount++
      if (callCount === 1) {
        throw new Error(`resolution failure for ${id}`)
      }
    })

    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockReturnValue([
        { id: 'ta', depends_on: null },
        { id: 'tb', depends_on: null }
      ])
    })
    const service = createTaskTerminalService(deps)

    service.onStatusTerminal('ta', 'done')
    service.onStatusTerminal('tb', 'done')

    vi.runAllTimers()

    const errorCalls = (deps.logger.error as ReturnType<typeof vi.fn>).mock.calls

    // Should have logged the individual per-task error (contains the failing task id)
    const hasPerTaskError = errorCalls.some((args: unknown[]) =>
      String(args[0]).includes('resolveDependents failed for')
    )
    expect(hasPerTaskError).toBe(true)

    // Should have logged a consolidated summary error mentioning "N of M ... failed"
    const hasConsolidatedError = errorCalls.some(
      (args: unknown[]) => String(args[0]).includes('of') && String(args[0]).includes('failed')
    )
    expect(hasConsolidatedError).toBe(true)
  })

  it('logs info with correct resolved/total counts on a partial-failure batch', () => {
    // Two tasks: ta fails, tb succeeds → resolved = 1, total = 2
    let callCount = 0
    mockResolveDependents.mockImplementation((id: string) => {
      callCount++
      if (callCount === 1) {
        throw new Error(`resolution failure for ${id}`)
      }
    })

    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockReturnValue([
        { id: 'ta', depends_on: null },
        { id: 'tb', depends_on: null }
      ])
    })
    const service = createTaskTerminalService(deps)

    service.onStatusTerminal('ta', 'done')
    service.onStatusTerminal('tb', 'done')

    vi.runAllTimers()

    expect(deps.logger.info).toHaveBeenCalledWith(
      '[task-terminal] resolved 1 dependents in 2 tasks'
    )
  })

  it('does not emit the batch success log when refreshTaskDepIndex throws', () => {
    mockRefreshDependencyIndex.mockImplementationOnce(() => {
      throw new Error('index boom')
    })
    const deps = makeDeps()
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    vi.runAllTimers()

    const infoCalls = (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls
    const hasBatchSuccessLog = infoCalls.some((args: unknown[]) =>
      String(args[0]).includes('[task-terminal] resolved')
    )
    expect(hasBatchSuccessLog).toBe(false)
  })
})
