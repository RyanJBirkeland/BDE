import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTaskTerminalService } from '../task-terminal-service'
import type { TaskTerminalServiceDeps } from '../task-terminal-service'

function makeDeps(overrides: Partial<TaskTerminalServiceDeps> = {}): TaskTerminalServiceDeps {
  return {
    getTask: vi.fn().mockReturnValue({ id: 't1', status: 'done', depends_on: null, notes: null }),
    updateTask: vi.fn(),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides
  }
}

describe('createTaskTerminalService', () => {
  it('calls resolveDependents when task reaches terminal status', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockReturnValue([
        { id: 't2', depends_on: [{ id: 't1', type: 'hard' }] }
      ]),
      getTask: vi.fn().mockImplementation((id: string) => {
        if (id === 't1') return { id: 't1', status: 'done', depends_on: null, notes: null }
        if (id === 't2') return { id: 't2', status: 'blocked', depends_on: [{ id: 't1', type: 'hard' }], notes: null }
        return null
      })
    })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')
    expect(deps.updateTask).toHaveBeenCalledWith('t2', expect.objectContaining({ status: 'queued' }))
  })

  it('does nothing for non-terminal statuses', () => {
    const deps = makeDeps()
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'active')
    expect(deps.getTasksWithDependencies).not.toHaveBeenCalled()
  })

  it('swallows errors and logs them', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockImplementation(() => { throw new Error('db boom') })
    })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('db boom'))
  })
})
