import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEpicGroupService, EpicCycleError, EpicNotFoundError } from './epic-group-service'
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
    expect(() => svc.addDependency('g2', { id: 'g1', condition: 'on_success' })).toThrow(
      EpicCycleError
    )
    expect(queries.addGroupDependency).not.toHaveBeenCalled()
  })

  it('throws on update when group does not exist', () => {
    queries.updateGroup.mockReturnValue(null)
    const svc = createEpicGroupService(queries)
    expect(() => svc.updateEpic('missing', { name: 'y' })).toThrow(EpicNotFoundError)
  })

  it('forwards goal: null through createEpic (clear-on-create semantic)', () => {
    const svc = createEpicGroupService(queries)
    svc.createEpic({ name: 'new', goal: null })
    expect(queries.createGroup).toHaveBeenCalledWith({ name: 'new', goal: null })
  })

  it('forwards goal: null through updateEpic (clear-goal signal)', () => {
    const svc = createEpicGroupService(queries)
    svc.updateEpic('g1', { goal: null })
    expect(queries.updateGroup).toHaveBeenCalledWith('g1', { goal: null })
  })

  it('forwards goal: undefined through updateEpic (leave-untouched signal)', () => {
    const svc = createEpicGroupService(queries)
    svc.updateEpic('g1', { name: 'renamed' })
    expect(queries.updateGroup).toHaveBeenCalledWith('g1', { name: 'renamed' })
  })

  it('throws on removeDependency when queries return null', () => {
    queries.removeGroupDependency.mockReturnValue(null)
    const svc = createEpicGroupService(queries)
    expect(() => svc.removeDependency('g1', 'upstream')).toThrow(/Failed to remove dependency/)
  })

  it('throws on updateDependencyCondition when queries return null', () => {
    queries.updateGroupDependencyCondition.mockReturnValue(null)
    const svc = createEpicGroupService(queries)
    expect(() => svc.updateDependencyCondition('g1', 'upstream', 'on_success')).toThrow(
      /Failed to update dependency condition/
    )
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

  describe('setDependencies (atomic)', () => {
    // Trivial transaction wrapper — just runs the fn. Real impl wraps in SQLite
    // transaction; we only care about call sequence + rollback semantics here.
    const runInTx = <T>(fn: () => T): T => fn()

    it('applies the full diff: adds, removes, and updates conditions in one call', () => {
      queries.getGroup.mockReturnValue(
        fakeGroup({
          id: 'g1',
          depends_on: [
            { id: 'a', condition: 'on_success' },
            { id: 'b', condition: 'on_success' }
          ]
        })
      )
      const svc = createEpicGroupService(queries, runInTx)

      svc.setDependencies('g1', [
        { id: 'a', condition: 'always' }, // update condition
        { id: 'c', condition: 'on_success' } // add
        // b removed
      ])

      expect(queries.removeGroupDependency).toHaveBeenCalledWith('g1', 'b')
      expect(queries.addGroupDependency).toHaveBeenCalledWith('g1', {
        id: 'c',
        condition: 'on_success'
      })
      expect(queries.updateGroupDependencyCondition).toHaveBeenCalledWith('g1', 'a', 'always')
    })

    it('rejects a cycle before mutating anything', () => {
      // child depends on parent in the current DB state.
      // Attempting to set child's deps to include its descendant should cycle.
      queries.getGroup.mockImplementation((id: string) => {
        if (id === 'child') return fakeGroup({ id: 'child', depends_on: null })
        if (id === 'parent')
          return fakeGroup({
            id: 'parent',
            depends_on: [{ id: 'child', condition: 'on_success' }]
          })
        return null
      })
      const svc = createEpicGroupService(queries, runInTx)

      expect(() =>
        svc.setDependencies('child', [{ id: 'parent', condition: 'on_success' }])
      ).toThrow(EpicCycleError)

      expect(queries.addGroupDependency).not.toHaveBeenCalled()
      expect(queries.removeGroupDependency).not.toHaveBeenCalled()
      expect(queries.updateGroupDependencyCondition).not.toHaveBeenCalled()
    })

    it('throws when a mid-sequence mutation fails and propagates the transaction rollback', () => {
      queries.getGroup.mockReturnValue(
        fakeGroup({
          id: 'g1',
          depends_on: [{ id: 'a', condition: 'on_success' }]
        })
      )
      // First addGroupDependency succeeds (for 'b'); second one fails.
      let addCallCount = 0
      queries.addGroupDependency.mockImplementation((id, dep) => {
        addCallCount++
        if (addCallCount === 1) return fakeGroup({ id, depends_on: [dep] })
        return null
      })

      const svc = createEpicGroupService(queries, runInTx)

      expect(() =>
        svc.setDependencies('g1', [
          { id: 'a', condition: 'on_success' },
          { id: 'b', condition: 'on_success' },
          { id: 'c', condition: 'on_success' }
        ])
      ).toThrow(/Failed to add dep c/)
    })

    it('throws when the epic does not exist', () => {
      queries.getGroup.mockReturnValue(null)
      const svc = createEpicGroupService(queries, runInTx)

      expect(() => svc.setDependencies('missing', [])).toThrow(EpicNotFoundError)
      expect(queries.addGroupDependency).not.toHaveBeenCalled()
    })
  })
})
