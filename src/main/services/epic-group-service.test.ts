import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEpicGroupService } from './epic-group-service'
import type { TaskGroup, EpicDependency } from '../../shared/types'

const fakeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'g1',
  name: 'Epic 1',
  icon: 'G',
  accent_color: '#0ff',
  goal: null,
  status: 'draft',
  created_at: '2026-04-17T00:00:00.000Z',
  updated_at: '2026-04-17T00:00:00.000Z',
  depends_on: null,
  ...overrides
})

describe('createEpicGroupService', () => {
  let queries: {
    createGroup: ReturnType<typeof vi.fn>
    listGroups: ReturnType<typeof vi.fn>
    getGroup: ReturnType<typeof vi.fn>
    updateGroup: ReturnType<typeof vi.fn>
    deleteGroup: ReturnType<typeof vi.fn>
    addTaskToGroup: ReturnType<typeof vi.fn>
    removeTaskFromGroup: ReturnType<typeof vi.fn>
    getGroupTasks: ReturnType<typeof vi.fn>
    reorderGroupTasks: ReturnType<typeof vi.fn>
    queueAllGroupTasks: ReturnType<typeof vi.fn>
    addGroupDependency: ReturnType<typeof vi.fn>
    removeGroupDependency: ReturnType<typeof vi.fn>
    updateGroupDependencyCondition: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    queries = {
      createGroup: vi.fn((input) => fakeGroup({ id: 'new', ...input })),
      listGroups: vi.fn(() => [fakeGroup()]),
      getGroup: vi.fn((id: string) => fakeGroup({ id })),
      updateGroup: vi.fn((id: string, patch) => fakeGroup({ id, ...patch })),
      deleteGroup: vi.fn(),
      addTaskToGroup: vi.fn(() => true),
      removeTaskFromGroup: vi.fn(() => true),
      getGroupTasks: vi.fn(() => []),
      reorderGroupTasks: vi.fn(() => true),
      queueAllGroupTasks: vi.fn(() => 0),
      addGroupDependency: vi.fn((id, dep) =>
        fakeGroup({ id, depends_on: [dep] as EpicDependency[] })
      ),
      removeGroupDependency: vi.fn((id) => fakeGroup({ id })),
      updateGroupDependencyCondition: vi.fn((id) => fakeGroup({ id }))
    }
  })

  it('rebuilds the dependency index on every mutation', () => {
    const svc = createEpicGroupService(queries)
    expect(queries.listGroups).toHaveBeenCalledTimes(1) // initial rebuild
    svc.createEpic({ name: 'x' })
    svc.updateEpic('g1', { name: 'y' })
    svc.deleteEpic('g1')
    // 1 init + 3 mutations = 4
    expect(queries.listGroups).toHaveBeenCalledTimes(4)
  })

  it('rejects a dependency that would introduce a cycle', () => {
    // g1 already depends on g2 (configured through queries mocks below).
    queries.listGroups.mockReturnValue([
      fakeGroup({ id: 'g1', depends_on: [{ id: 'g2', condition: 'on_success' }] }),
      fakeGroup({ id: 'g2', depends_on: null })
    ])
    queries.getGroup.mockImplementation((id: string) => {
      if (id === 'g2') return fakeGroup({ id: 'g2', depends_on: null })
      return fakeGroup({ id: 'g1', depends_on: [{ id: 'g2', condition: 'on_success' }] })
    })

    const svc = createEpicGroupService(queries)
    // Attempting g2 → g1 closes the cycle.
    expect(() => svc.addDependency('g2', { id: 'g1', condition: 'on_success' })).toThrow(/cycle/i)
    expect(queries.addGroupDependency).not.toHaveBeenCalled()
  })

  it('throws on update when group does not exist', () => {
    queries.updateGroup.mockReturnValue(null)
    const svc = createEpicGroupService(queries)
    expect(() => svc.updateEpic('missing', { name: 'y' })).toThrow(/not found/)
  })

  it('throws on removeDependency when queries return null', () => {
    queries.removeGroupDependency.mockReturnValue(null)
    const svc = createEpicGroupService(queries)
    expect(() => svc.removeDependency('g1', 'upstream')).toThrow(/Failed to remove dependency/)
  })

  it('throws on updateDependencyCondition when queries return null', () => {
    queries.updateGroupDependencyCondition.mockReturnValue(null)
    const svc = createEpicGroupService(queries)
    expect(() => svc.updateDependencyCondition('g1', 'upstream', 'on_success')).toThrow(/Failed to update dependency condition/)
  })

  it('exposes an EpicDepsReader — getDependentEpics reflects the live graph', () => {
    queries.listGroups.mockReturnValue([
      fakeGroup({ id: 'parent', depends_on: null }),
      fakeGroup({ id: 'child', depends_on: [{ id: 'parent', condition: 'on_success' }] })
    ])
    const svc = createEpicGroupService(queries)
    expect(svc.getDependentEpics('parent')).toEqual(new Set(['child']))
    expect(svc.getDependentEpics('child').size).toBe(0)
  })

  it('areEpicDepsSatisfied returns satisfied=true when all upstream tasks are done', () => {
    queries.listGroups.mockReturnValue([
      fakeGroup({ id: 'parent' }),
      fakeGroup({ id: 'child', depends_on: [{ id: 'parent', condition: 'on_success' }] })
    ])
    const svc = createEpicGroupService(queries)
    const result = svc.areEpicDepsSatisfied(
      'child',
      [{ id: 'parent', condition: 'on_success' }],
      () => 'ready',
      () => [{ status: 'done' }]
    )
    expect(result.satisfied).toBe(true)
  })
})
