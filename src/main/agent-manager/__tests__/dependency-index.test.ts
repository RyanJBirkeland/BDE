import { describe, test, expect } from 'vitest'
import { createDependencyIndex, detectCycle } from '../dependency-index'
import type { TaskDependency } from '../../../shared/types'

describe('DependencyIndex', () => {
  describe('rebuild', () => {
    test('populates reverse index from task list', () => {
      const idx = createDependencyIndex()
      idx.rebuild([
        { id: 'A', depends_on: [{ id: 'B', type: 'hard' }] },
        { id: 'C', depends_on: [{ id: 'B', type: 'soft' }] },
      ])
      expect(idx.getDependents('B')).toEqual(new Set(['A', 'C']))
    })

    test('handles null depends_on', () => {
      const idx = createDependencyIndex()
      idx.rebuild([
        { id: 'A', depends_on: null },
        { id: 'B', depends_on: [{ id: 'A', type: 'hard' }] },
      ])
      expect(idx.getDependents('A')).toEqual(new Set(['B']))
      expect(idx.getDependents('X')).toEqual(new Set())
    })

    test('clears previous state on rebuild', () => {
      const idx = createDependencyIndex()
      idx.rebuild([{ id: 'A', depends_on: [{ id: 'X', type: 'hard' }] }])
      idx.rebuild([{ id: 'B', depends_on: [{ id: 'Y', type: 'hard' }] }])
      expect(idx.getDependents('X')).toEqual(new Set())
      expect(idx.getDependents('Y')).toEqual(new Set(['B']))
    })
  })

describe('areDependenciesSatisfied', () => {
    test('empty deps = satisfied', () => {
      const idx = createDependencyIndex()
      const result = idx.areDependenciesSatisfied('T', [], () => undefined)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    test('hard dep done = satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'hard' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'done')
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    test('hard dep failed = NOT satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'hard' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'failed')
      expect(result.satisfied).toBe(false)
      expect(result.blockedBy).toContain('A')
    })

    test('hard dep cancelled = NOT satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'hard' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'cancelled')
      expect(result.satisfied).toBe(false)
    })

    test('hard dep error = NOT satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'hard' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'error')
      expect(result.satisfied).toBe(false)
    })

    test('hard dep active = NOT satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'hard' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'active')
      expect(result.satisfied).toBe(false)
    })

    test('soft dep failed = satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'soft' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'failed')
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    test('soft dep cancelled = satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'soft' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'cancelled')
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    test('soft dep active = NOT satisfied (not terminal)', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'A', type: 'soft' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => 'active')
      expect(result.satisfied).toBe(false)
      expect(result.blockedBy).toContain('A')
    })

    test('deleted dep (undefined status) = satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [{ id: 'GONE', type: 'hard' }]
      const result = idx.areDependenciesSatisfied('T', deps, () => undefined)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    test('mixed hard+soft deps — all satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [
        { id: 'A', type: 'hard' },
        { id: 'B', type: 'soft' },
      ]
      const statuses: Record<string, string> = { A: 'done', B: 'failed' }
      const result = idx.areDependenciesSatisfied('T', deps, (id) => statuses[id])
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    test('mixed hard+soft deps — hard not satisfied', () => {
      const idx = createDependencyIndex()
      const deps: TaskDependency[] = [
        { id: 'A', type: 'hard' },
        { id: 'B', type: 'soft' },
      ]
      const statuses: Record<string, string> = { A: 'active', B: 'done' }
      const result = idx.areDependenciesSatisfied('T', deps, (id) => statuses[id])
      expect(result.satisfied).toBe(false)
      expect(result.blockedBy).toEqual(['A'])
    })
  })
})

describe('detectCycle', () => {
  test('no cycle → null', () => {
    const deps: Record<string, TaskDependency[]> = {
      B: [{ id: 'C', type: 'hard' }],
    }
    const result = detectCycle('A', [{ id: 'B', type: 'hard' }], (id) => deps[id] ?? null)
    expect(result).toBeNull()
  })

  test('self-cycle → path', () => {
    const result = detectCycle('A', [{ id: 'A', type: 'hard' }], () => null)
    expect(result).toEqual(['A', 'A'])
  })

  test('A→B→A cycle → path containing A and B', () => {
    const deps: Record<string, TaskDependency[]> = {
      B: [{ id: 'A', type: 'hard' }],
    }
    const result = detectCycle('A', [{ id: 'B', type: 'hard' }], (id) => deps[id] ?? null)
    expect(result).not.toBeNull()
    expect(result).toContain('A')
    expect(result).toContain('B')
  })

  test('A→B→C→A deep cycle → path containing A', () => {
    const deps: Record<string, TaskDependency[]> = {
      B: [{ id: 'C', type: 'hard' }],
      C: [{ id: 'A', type: 'hard' }],
    }
    const result = detectCycle('A', [{ id: 'B', type: 'hard' }], (id) => deps[id] ?? null)
    expect(result).not.toBeNull()
    expect(result).toContain('A')
  })

  test('diamond shape (not a cycle) → null', () => {
    // A→B, A→C, B→D, C→D — diamond, not a cycle
    const deps: Record<string, TaskDependency[]> = {
      B: [{ id: 'D', type: 'hard' }],
      C: [{ id: 'D', type: 'hard' }],
    }
    const result = detectCycle(
      'A',
      [
        { id: 'B', type: 'hard' },
        { id: 'C', type: 'hard' },
      ],
      (id) => deps[id] ?? null,
    )
    expect(result).toBeNull()
  })

  test('missing tasks in lookup → null (no crash)', () => {
    const result = detectCycle('A', [{ id: 'B', type: 'hard' }], () => null)
    expect(result).toBeNull()
  })
})
