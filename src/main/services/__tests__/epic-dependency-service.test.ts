import { describe, it, expect } from 'vitest'
import {
  createEpicDependencyIndex,
  detectEpicCycle,
  TERMINAL_STATUSES,
  HARD_SATISFIED_STATUSES
} from '../epic-dependency-service'
import type { EpicDependency } from '../../../shared/types'

describe('epic-dependency-service', () => {
  describe('createEpicDependencyIndex', () => {
    describe('rebuild/update/remove', () => {
      it('should build reverse index from epic list', () => {
        const idx = createEpicDependencyIndex()
        idx.rebuild([
          { id: 'epic-a', depends_on: null },
          { id: 'epic-b', depends_on: [{ id: 'epic-a', condition: 'on_success' }] },
          {
            id: 'epic-c',
            depends_on: [
              { id: 'epic-a', condition: 'always' },
              { id: 'epic-b', condition: 'manual' }
            ]
          }
        ])

        expect(idx.getDependentEpics('epic-a')).toEqual(new Set(['epic-b', 'epic-c']))
        expect(idx.getDependentEpics('epic-b')).toEqual(new Set(['epic-c']))
        expect(idx.getDependentEpics('epic-c')).toEqual(new Set())
      })

      it('should update dependencies correctly', () => {
        const idx = createEpicDependencyIndex()
        idx.rebuild([
          { id: 'epic-a', depends_on: null },
          { id: 'epic-b', depends_on: [{ id: 'epic-a', condition: 'on_success' }] }
        ])

        expect(idx.getDependentEpics('epic-a')).toEqual(new Set(['epic-b']))

        idx.update('epic-b', [{ id: 'epic-c', condition: 'always' }])

        expect(idx.getDependentEpics('epic-a')).toEqual(new Set())
        expect(idx.getDependentEpics('epic-c')).toEqual(new Set(['epic-b']))
      })

      it('should remove epic and cleanup reverse edges', () => {
        const idx = createEpicDependencyIndex()
        idx.rebuild([
          { id: 'epic-a', depends_on: null },
          { id: 'epic-b', depends_on: [{ id: 'epic-a', condition: 'on_success' }] },
          { id: 'epic-c', depends_on: [{ id: 'epic-b', condition: 'manual' }] }
        ])

        idx.remove('epic-b')

        expect(idx.getDependentEpics('epic-a')).toEqual(new Set())
        expect(idx.getDependentEpics('epic-b')).toEqual(new Set())
      })

      it('should handle empty depends_on array', () => {
        const idx = createEpicDependencyIndex()
        idx.rebuild([{ id: 'epic-a', depends_on: [] }])

        expect(idx.getDependentEpics('epic-a')).toEqual(new Set())
      })
    })

    describe('areEpicDepsSatisfied - on_success condition', () => {
      it('should be satisfied when all upstream tasks are done', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'on_success' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => [{ status: 'done' }, { status: 'done' }]
        )

        expect(result).toEqual({ satisfied: true, blockedBy: [] })
      })

      it('should be blocked when any upstream task is not done', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'on_success' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => [{ status: 'done' }, { status: 'active' }]
        )

        expect(result).toEqual({ satisfied: false, blockedBy: ['epic-upstream'] })
      })

      it('should be satisfied for zero-task upstream (vacuous truth)', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'on_success' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => []
        )

        expect(result).toEqual({ satisfied: true, blockedBy: [] })
      })

      it('should be blocked when upstream tasks include failed status', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'on_success' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => [{ status: 'done' }, { status: 'failed' }]
        )

        expect(result).toEqual({ satisfied: false, blockedBy: ['epic-upstream'] })
      })
    })

    describe('areEpicDepsSatisfied - always condition', () => {
      it('should be satisfied when all upstream tasks are terminal', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'always' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => [{ status: 'done' }, { status: 'failed' }, { status: 'cancelled' }]
        )

        expect(result).toEqual({ satisfied: true, blockedBy: [] })
      })

      it('should be blocked when any upstream task is non-terminal', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'always' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => [{ status: 'done' }, { status: 'active' }]
        )

        expect(result).toEqual({ satisfied: false, blockedBy: ['epic-upstream'] })
      })

      it('should be satisfied for zero-task upstream (vacuous truth)', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'always' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => []
        )

        expect(result).toEqual({ satisfied: true, blockedBy: [] })
      })

      it('should verify TERMINAL_STATUSES coverage', () => {
        // Ensure our fixture covers all terminal statuses
        expect(TERMINAL_STATUSES.has('done')).toBe(true)
        expect(TERMINAL_STATUSES.has('failed')).toBe(true)
        expect(TERMINAL_STATUSES.has('error')).toBe(true)
        expect(TERMINAL_STATUSES.has('cancelled')).toBe(true)
      })
    })

    describe('areEpicDepsSatisfied - manual condition', () => {
      it('should be satisfied when upstream epic status is completed', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'manual' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'completed',
          () => [{ status: 'active' }] // Task statuses ignored for manual
        )

        expect(result).toEqual({ satisfied: true, blockedBy: [] })
      })

      it('should be blocked when upstream epic status is not completed', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'manual' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'in-pipeline',
          () => [{ status: 'done' }] // All tasks done, but epic not manually completed
        )

        expect(result).toEqual({ satisfied: false, blockedBy: ['epic-upstream'] })
      })

      it('should be blocked for zero-task upstream (NOT vacuous truth)', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-upstream', condition: 'manual' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => 'ready',
          () => []
        )

        expect(result).toEqual({ satisfied: false, blockedBy: ['epic-upstream'] })
      })
    })

    describe('areEpicDepsSatisfied - edge cases', () => {
      it('should treat deleted upstream epic as satisfied', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [{ id: 'epic-deleted', condition: 'on_success' }]

        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          deps,
          () => undefined, // Deleted epic
          () => undefined
        )

        expect(result).toEqual({ satisfied: true, blockedBy: [] })
      })

      it('should handle multiple dependencies with mixed satisfaction', () => {
        const idx = createEpicDependencyIndex()
        const deps: EpicDependency[] = [
          { id: 'epic-a', condition: 'on_success' },
          { id: 'epic-b', condition: 'always' },
          { id: 'epic-c', condition: 'manual' }
        ]

        const getStatus = (id: string) => {
          if (id === 'epic-a') return 'ready'
          if (id === 'epic-b') return 'in-pipeline'
          if (id === 'epic-c') return 'completed'
          return undefined
        }

        const getTasks = (id: string) => {
          if (id === 'epic-a') return [{ status: 'done' }]
          if (id === 'epic-b') return [{ status: 'active' }]
          if (id === 'epic-c') return [{ status: 'queued' }]
          return undefined
        }

        const result = idx.areEpicDepsSatisfied('epic-downstream', deps, getStatus, getTasks)

        // epic-a: on_success with 'done' → satisfied
        // epic-b: always with 'active' → blocked
        // epic-c: manual with status='completed' → satisfied (tasks ignored)
        expect(result).toEqual({ satisfied: false, blockedBy: ['epic-b'] })
      })

      it('should handle empty dependency list', () => {
        const idx = createEpicDependencyIndex()
        const result = idx.areEpicDepsSatisfied(
          'epic-downstream',
          [],
          () => 'ready',
          () => []
        )

        expect(result).toEqual({ satisfied: true, blockedBy: [] })
      })

      it('should verify HARD_SATISFIED_STATUSES is just done', () => {
        // Sanity check: on_success should only accept 'done'
        expect(HARD_SATISFIED_STATUSES.has('done')).toBe(true)
        expect(HARD_SATISFIED_STATUSES.has('failed')).toBe(false)
        expect(HARD_SATISFIED_STATUSES.has('error')).toBe(false)
      })
    })
  })

  describe('detectEpicCycle', () => {
    it('should detect self-reference', () => {
      const getDeps = () => null
      const deps: EpicDependency[] = [{ id: 'epic-a', condition: 'on_success' }]

      const cycle = detectEpicCycle('epic-a', deps, getDeps)

      expect(cycle).toEqual(['epic-a', 'epic-a'])
    })

    it('should detect 2-node cycle', () => {
      const getDeps = (id: string) => {
        if (id === 'epic-b') return [{ id: 'epic-a', condition: 'always' }]
        return null
      }
      const deps: EpicDependency[] = [{ id: 'epic-b', condition: 'on_success' }]

      const cycle = detectEpicCycle('epic-a', deps, getDeps)

      expect(cycle).toEqual(['epic-a', 'epic-b', 'epic-a'])
    })

    it('should detect 3-node cycle', () => {
      const getDeps = (id: string) => {
        if (id === 'epic-b') return [{ id: 'epic-c', condition: 'manual' }]
        if (id === 'epic-c') return [{ id: 'epic-a', condition: 'on_success' }]
        return null
      }
      const deps: EpicDependency[] = [{ id: 'epic-b', condition: 'always' }]

      const cycle = detectEpicCycle('epic-a', deps, getDeps)

      expect(cycle).toEqual(['epic-a', 'epic-b', 'epic-c', 'epic-a'])
    })

    it('should return null for acyclic DAG', () => {
      const getDeps = (id: string) => {
        if (id === 'epic-b') return [{ id: 'epic-d', condition: 'on_success' }]
        if (id === 'epic-c') return [{ id: 'epic-d', condition: 'always' }]
        return null
      }
      const deps: EpicDependency[] = [
        { id: 'epic-b', condition: 'on_success' },
        { id: 'epic-c', condition: 'manual' }
      ]

      const cycle = detectEpicCycle('epic-a', deps, getDeps)

      expect(cycle).toBeNull()
    })

    it('should return null for empty dependencies', () => {
      const getDeps = () => null
      const cycle = detectEpicCycle('epic-a', [], getDeps)

      expect(cycle).toBeNull()
    })

    it('should handle multiple proposed deps without cycles', () => {
      const getDeps = (id: string) => {
        if (id === 'epic-b') return [{ id: 'epic-d', condition: 'on_success' }]
        if (id === 'epic-c') return [{ id: 'epic-e', condition: 'always' }]
        return null
      }
      const deps: EpicDependency[] = [
        { id: 'epic-b', condition: 'on_success' },
        { id: 'epic-c', condition: 'manual' }
      ]

      const cycle = detectEpicCycle('epic-a', deps, getDeps)

      expect(cycle).toBeNull()
    })

    it('should stop at visited nodes to prevent infinite loops', () => {
      const getDeps = (id: string) => {
        // Create a cycle that doesn't include the source epic
        if (id === 'epic-b') return [{ id: 'epic-c', condition: 'on_success' }]
        if (id === 'epic-c') return [{ id: 'epic-b', condition: 'always' }]
        return null
      }
      const deps: EpicDependency[] = [{ id: 'epic-b', condition: 'manual' }]

      const cycle = detectEpicCycle('epic-a', deps, getDeps)

      // Should return null because epic-a is not part of the b-c loop
      expect(cycle).toBeNull()
    })
  })
})
