import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../data/task-group-queries', () => ({
  createGroup: vi.fn(),
  listGroups: vi.fn().mockReturnValue([]),
  getGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addTaskToGroup: vi.fn(),
  removeTaskFromGroup: vi.fn(),
  getGroupTasks: vi.fn().mockReturnValue([]),
  queueAllGroupTasks: vi.fn(),
  reorderGroupTasks: vi.fn(),
  addGroupDependency: vi.fn(),
  removeGroupDependency: vi.fn(),
  updateGroupDependencyCondition: vi.fn()
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

// epic-dependency-service uses real cycle detection logic
// We don't mock it so the real detectEpicCycle runs

import { registerGroupHandlers } from '../group-handlers'
import { safeHandle } from '../../ipc-utils'
import * as groupQueries from '../../data/task-group-queries'
import { createEpicGroupService } from '../../services/epic-group-service'

type Handler = (event: unknown, ...args: unknown[]) => unknown

describe('groups:addDependency cycle detection', () => {
  let handlers: Record<string, Handler>
  const mockEvent = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers[channel as string] = handler as Handler
    })
    registerGroupHandlers(createEpicGroupService())
  })

  it('throws on self-cycle (epicId === dep.id)', () => {
    vi.mocked(groupQueries.getGroup).mockReturnValue({
      id: 'epic-A',
      name: 'Epic A',
      icon: 'G',
      accent_color: '#fff',
      goal: null,
      status: 'draft',
      created_at: '',
      updated_at: '',
      depends_on: []
    })

    expect(() =>
      handlers['groups:addDependency'](mockEvent, 'epic-A', {
        id: 'epic-A',
        condition: 'on_success'
      })
    ).toThrow(/cycle/i)

    expect(groupQueries.addGroupDependency).not.toHaveBeenCalled()
  })

  it('throws on transitive cycle (A depends on B, then adding B depends on A)', () => {
    vi.mocked(groupQueries.getGroup).mockImplementation((id: string) => {
      if (id === 'epic-A') {
        return {
          id: 'epic-A',
          name: 'A',
          icon: 'G',
          accent_color: '#fff',
          goal: null,
          status: 'draft',
          created_at: '',
          updated_at: '',
          depends_on: []
        }
      }
      if (id === 'epic-B') {
        return {
          id: 'epic-B',
          name: 'B',
          icon: 'G',
          accent_color: '#fff',
          goal: null,
          status: 'draft',
          created_at: '',
          updated_at: '',
          depends_on: [{ id: 'epic-A', condition: 'on_success' as const }]
        }
      }
      return null
    })

    // epic-A already has no deps. epic-B depends on epic-A.
    // Now trying to make epic-A depend on epic-B creates A->B->A cycle.
    expect(() =>
      handlers['groups:addDependency'](mockEvent, 'epic-A', { id: 'epic-B', condition: 'always' })
    ).toThrow(/cycle/i)

    expect(groupQueries.addGroupDependency).not.toHaveBeenCalled()
  })

  it('allows adding a non-cyclical dependency', () => {
    vi.mocked(groupQueries.getGroup).mockImplementation((id: string) => ({
      id,
      name: id,
      icon: 'G',
      accent_color: '#fff',
      goal: null,
      status: 'draft',
      created_at: '',
      updated_at: '',
      depends_on: []
    }))
    vi.mocked(groupQueries.addGroupDependency).mockReturnValue({
      id: 'epic-A',
      name: 'A',
      icon: 'G',
      accent_color: '#fff',
      goal: null,
      status: 'draft',
      created_at: '',
      updated_at: '',
      depends_on: [{ id: 'epic-B', condition: 'on_success' as const }]
    })

    expect(() =>
      handlers['groups:addDependency'](mockEvent, 'epic-A', {
        id: 'epic-B',
        condition: 'on_success'
      })
    ).not.toThrow()

    expect(groupQueries.addGroupDependency).toHaveBeenCalledOnce()
  })
})
