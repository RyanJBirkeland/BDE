import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTaskTerminalService } from '../task-terminal-service'
import type { TaskTerminalServiceDeps } from '../task-terminal-service'

function makeDeps(overrides: Partial<TaskTerminalServiceDeps> = {}): TaskTerminalServiceDeps {
  return {
    getTask: vi.fn().mockReturnValue({
      id: 't1',
      title: 'Test Task',
      status: 'done',
      depends_on: null,
      notes: null
    }),
    updateTask: vi.fn(),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getSetting: vi.fn().mockReturnValue(null),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides
  }
}

describe('createTaskTerminalService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls resolveDependents when task reaches terminal status', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi
        .fn()
        .mockReturnValue([{ id: 't2', depends_on: [{ id: 't1', type: 'hard' }] }]),
      getTask: vi.fn().mockImplementation((id: string) => {
        if (id === 't1')
          return { id: 't1', title: 'Task 1', status: 'done', depends_on: null, notes: null }
        if (id === 't2')
          return {
            id: 't2',
            title: 'Task 2',
            status: 'blocked',
            depends_on: [{ id: 't1', type: 'hard' }],
            notes: null
          }
        return null
      })
    })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')

    // Resolution is deferred via setTimeout(0)
    expect(deps.updateTask).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(deps.updateTask).toHaveBeenCalledWith(
      't2',
      expect.objectContaining({ status: 'queued' })
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
        .mockReturnValue([{ id: 't2', depends_on: [{ id: 't1', type: 'hard' }] }]),
      getTask: vi.fn().mockImplementation((id: string) => {
        if (id === 't1')
          return { id: 't1', title: 'Task 1', status: 'done', depends_on: null, notes: null }
        if (id === 't2')
          return {
            id: 't2',
            title: 'Task 2',
            status: 'blocked',
            depends_on: [{ id: 't1', type: 'hard' }],
            notes: null
          }
        return null
      })
    })
    const service = createTaskTerminalService(deps)

    // Call same task 3 times with different statuses (last write wins)
    service.onStatusTerminal('t1', 'done')
    service.onStatusTerminal('t1', 'failed')
    service.onStatusTerminal('t1', 'done')

    vi.runAllTimers()

    // updateTask should be called once for t2 (t1's dependent)
    expect(deps.updateTask).toHaveBeenCalledTimes(1)
    expect(deps.updateTask).toHaveBeenCalledWith(
      't2',
      expect.objectContaining({ status: 'queued' })
    )
  })
})
