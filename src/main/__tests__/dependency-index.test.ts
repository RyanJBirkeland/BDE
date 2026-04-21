import { describe, it, expect, vi } from 'vitest'
import { createDependencyIndex, detectCycle } from '../services/dependency-service'

describe('createDependencyIndex', () => {
  it('returns empty dependents for unknown task', () => {
    const index = createDependencyIndex()
    index.rebuild([])
    expect(index.getDependents('nonexistent').size).toBe(0)
  })

  it('builds reverse map from task dependencies', () => {
    const index = createDependencyIndex()
    index.rebuild([{ id: 'child', depends_on: [{ id: 'parent', type: 'hard' }] }])
    const deps = index.getDependents('parent')
    expect(deps.has('child')).toBe(true)
  })

  it('tracks multiple dependents for same parent', () => {
    const index = createDependencyIndex()
    index.rebuild([
      { id: 'a', depends_on: [{ id: 'parent', type: 'hard' }] },
      { id: 'b', depends_on: [{ id: 'parent', type: 'soft' }] }
    ])
    expect(index.getDependents('parent').size).toBe(2)
  })

  it('handles tasks with null depends_on', () => {
    const index = createDependencyIndex()
    index.rebuild([
      { id: 'a', depends_on: null },
      { id: 'b', depends_on: [{ id: 'a', type: 'hard' }] }
    ])
    expect(index.getDependents('a').size).toBe(1)
  })

  it('clears previous data on rebuild', () => {
    const index = createDependencyIndex()
    index.rebuild([{ id: 'child', depends_on: [{ id: 'parent', type: 'hard' }] }])
    expect(index.getDependents('parent').size).toBe(1)

    index.rebuild([])
    expect(index.getDependents('parent').size).toBe(0)
  })

  describe('areDependenciesSatisfied', () => {
    it('returns satisfied=true when no deps', () => {
      const index = createDependencyIndex()
      const result = index.areDependenciesSatisfied('task1', [], () => undefined)
      expect(result.satisfied).toBe(true)
      expect(result.blockedBy).toEqual([])
    })

    it('returns satisfied=true when all hard deps are done', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'hard' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'done')
      expect(result.satisfied).toBe(true)
      expect(result.blockedBy).toEqual([])
    })

    it('returns satisfied=false when hard dep is not done', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'hard' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'active')
      expect(result.satisfied).toBe(false)
      expect(result.blockedBy).toContain('dep1')
    })

    it('hard dep: failed status does not satisfy', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'hard' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'failed')
      expect(result.satisfied).toBe(false)
    })

    it('soft dep: satisfied when terminal (done)', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'soft' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'done')
      expect(result.satisfied).toBe(true)
    })

    it('soft dep: satisfied when terminal (failed)', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'soft' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'failed')
      expect(result.satisfied).toBe(true)
    })

    it('soft dep: satisfied when terminal (cancelled)', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'soft' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'cancelled')
      expect(result.satisfied).toBe(true)
    })

    it('soft dep: satisfied when terminal (error)', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'soft' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'error')
      expect(result.satisfied).toBe(true)
    })

    it('soft dep: not satisfied when still active', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'dep1', type: 'soft' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => 'active')
      expect(result.satisfied).toBe(false)
      expect(result.blockedBy).toContain('dep1')
    })

    it('deleted dep (undefined status) is treated as satisfied', () => {
      const index = createDependencyIndex()
      const deps = [{ id: 'deleted-dep', type: 'hard' as const }]
      const result = index.areDependenciesSatisfied('task1', deps, () => undefined)
      expect(result.satisfied).toBe(true)
    })

    it('mixed deps: all must be satisfied', () => {
      const index = createDependencyIndex()
      const deps = [
        { id: 'hard-dep', type: 'hard' as const },
        { id: 'soft-dep', type: 'soft' as const }
      ]
      const getStatus = (id: string) => {
        if (id === 'hard-dep') return 'done'
        if (id === 'soft-dep') return 'active'
        return undefined
      }
      const result = index.areDependenciesSatisfied('task1', deps, getStatus)
      expect(result.satisfied).toBe(false)
      expect(result.blockedBy).toContain('soft-dep')
      expect(result.blockedBy).not.toContain('hard-dep')
    })
  })
})

describe('areDependenciesSatisfied — deprecation warning for condition-less deps', () => {
  it('emits no warning when all deps have condition field', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const idx = createDependencyIndex()
    idx.areDependenciesSatisfied(
      'task-a',
      [{ id: 'dep-1', type: 'hard', condition: 'on_success' }],
      () => 'done'
    )
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('emits a deprecation warning when a dep lacks condition field', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const idx = createDependencyIndex()
    idx.areDependenciesSatisfied('task-a', [{ id: 'dep-1', type: 'hard' }], () => 'done')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[deprecation]'))
    warnSpy.mockRestore()
  })
})

describe('detectCycle', () => {
  it('returns null for no dependencies', () => {
    expect(detectCycle('a', [], () => null)).toBeNull()
  })

  it('returns null for a simple valid chain', () => {
    const getDeps = (id: string) => {
      if (id === 'b') return [{ id: 'c', type: 'hard' as const }]
      return null
    }
    expect(detectCycle('a', [{ id: 'b', type: 'hard' }], getDeps)).toBeNull()
  })

  it('detects direct cycle', () => {
    // a -> b -> a (cycle!)
    const getDeps = (id: string) => {
      if (id === 'b') return [{ id: 'a', type: 'hard' as const }]
      return null
    }
    const result = detectCycle('a', [{ id: 'b', type: 'hard' }], getDeps)
    expect(result).not.toBeNull()
    expect(result).toContain('a')
    expect(result).toContain('b')
  })

  it('detects indirect cycle', () => {
    // a -> b -> c -> a (cycle!)
    const getDeps = (id: string) => {
      if (id === 'b') return [{ id: 'c', type: 'hard' as const }]
      if (id === 'c') return [{ id: 'a', type: 'hard' as const }]
      return null
    }
    const result = detectCycle('a', [{ id: 'b', type: 'hard' }], getDeps)
    expect(result).not.toBeNull()
    expect(result).toContain('a')
  })

  it('handles self-dependency', () => {
    const result = detectCycle('a', [{ id: 'a', type: 'hard' }], () => null)
    expect(result).not.toBeNull()
    expect(result).toEqual(['a', 'a'])
  })

  it('returns null when no cycle exists in diamond graph', () => {
    // a -> b, a -> c, b -> d, c -> d (no cycle)
    const getDeps = (id: string) => {
      if (id === 'b') return [{ id: 'd', type: 'hard' as const }]
      if (id === 'c') return [{ id: 'd', type: 'hard' as const }]
      return null
    }
    const result = detectCycle(
      'a',
      [
        { id: 'b', type: 'hard' },
        { id: 'c', type: 'hard' }
      ],
      getDeps
    )
    expect(result).toBeNull()
  })
})
