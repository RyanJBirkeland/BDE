import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTaskTerminalService } from '../task-terminal-service'
import type { TaskTerminalServiceDeps } from '../task-terminal-service'

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

// Controllable mock for resolveDependents — used in the consolidated error test
const mockResolveDependents = vi.fn()
vi.mock('../../agent-manager/resolve-dependents', () => ({
  resolveDependents: (...args: unknown[]) => mockResolveDependents(...args)
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
    getGroupsWithDependencies: vi.fn().mockReturnValue([]),
    listGroupTasks: vi.fn().mockReturnValue([]),
    getSetting: vi.fn().mockReturnValue(null),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides
  }
}

describe('createTaskTerminalService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default: resolveDependents succeeds (no-op); individual tests can override
    mockResolveDependents.mockReset()
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
      undefined // runInTransaction (not provided by default)
    )
  })

  it('does nothing for non-terminal statuses', () => {
    const deps = makeDeps()
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'active')

    vi.runAllTimers()

    expect(deps.getTasksWithDependencies).not.toHaveBeenCalled()
  })

  it('swallows errors and logs them', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockImplementation(() => {
        throw new Error('db boom')
      })
    })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    vi.runAllTimers()

    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('db boom'))
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
    expect(deps.getTasksWithDependencies).not.toHaveBeenCalled()

    // Advance timers to flush setTimeout(0)
    vi.runAllTimers()

    // rebuildIndex should be called exactly once (not 5 times)
    expect(deps.getTasksWithDependencies).toHaveBeenCalledTimes(1)
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
      undefined // runInTransaction (not provided by default)
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
    const hasConsolidatedError = errorCalls.some((args: unknown[]) =>
      String(args[0]).includes('of') && String(args[0]).includes('failed')
    )
    expect(hasConsolidatedError).toBe(true)
  })
})
