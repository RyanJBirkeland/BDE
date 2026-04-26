import { describe, it, expect } from 'vitest'
import {
  validateDependencyGraph,
  DependencyGraph,
  createDependencyIndex
} from '../../services/dependency-graph'
import type { TaskDependency } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SeedTask = { id: string; depends_on: TaskDependency[] | null }

function makeDeps(tasks: SeedTask[]) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  return {
    getTask: (id: string) => taskMap.get(id) ?? null,
    listTasks: () => tasks
  }
}

function hard(id: string): TaskDependency {
  return { id, type: 'hard' }
}

// ---------------------------------------------------------------------------
// validateDependencyGraph — acyclic graphs
// ---------------------------------------------------------------------------

describe('validateDependencyGraph — valid graphs', () => {
  it('returns { valid: true } for a linear chain A → B → C', () => {
    const tasks: SeedTask[] = [
      { id: 'A', depends_on: null },
      { id: 'B', depends_on: [hard('C')] },
      { id: 'C', depends_on: null }
    ]
    const result = validateDependencyGraph('A', [hard('B')], makeDeps(tasks))
    expect(result).toEqual({ valid: true })
  })

  it('returns { valid: true } for empty proposed deps', () => {
    const tasks: SeedTask[] = [{ id: 'A', depends_on: null }]
    const result = validateDependencyGraph('A', [], makeDeps(tasks))
    expect(result).toEqual({ valid: true })
  })

  it('returns { valid: true } for a diamond shape (A→B, A→C, B→D, C→D)', () => {
    const tasks: SeedTask[] = [
      { id: 'A', depends_on: null },
      { id: 'B', depends_on: [hard('D')] },
      { id: 'C', depends_on: [hard('D')] },
      { id: 'D', depends_on: null }
    ]
    const result = validateDependencyGraph('A', [hard('B'), hard('C')], makeDeps(tasks))
    expect(result).toEqual({ valid: true })
  })
})

// ---------------------------------------------------------------------------
// validateDependencyGraph — cycle detection
// ---------------------------------------------------------------------------

describe('validateDependencyGraph — cycle detection', () => {
  it('returns { valid: false, cycle: ["A","A"] } for self-cycle A → A', () => {
    const tasks: SeedTask[] = [{ id: 'A', depends_on: null }]
    const result = validateDependencyGraph('A', [hard('A')], makeDeps(tasks))
    expect(result).toMatchObject({ valid: false })
    expect('cycle' in result && result.cycle).toEqual(['A', 'A'])
  })

  it('returns { valid: false } with cycle containing A and B for two-node cycle A → B → A', () => {
    const tasks: SeedTask[] = [
      { id: 'A', depends_on: null },
      { id: 'B', depends_on: [hard('A')] }
    ]
    const result = validateDependencyGraph('A', [hard('B')], makeDeps(tasks))
    expect(result).toMatchObject({ valid: false })
    expect('cycle' in result && result.cycle).toEqual(expect.arrayContaining(['A', 'B']))
  })

  it('returns { valid: false } with cycle containing A for three-node cycle A → B → C → A', () => {
    const tasks: SeedTask[] = [
      { id: 'A', depends_on: null },
      { id: 'B', depends_on: [hard('C')] },
      { id: 'C', depends_on: [hard('A')] }
    ]
    const result = validateDependencyGraph('A', [hard('B')], makeDeps(tasks))
    expect(result).toMatchObject({ valid: false })
    expect('cycle' in result && result.cycle).toEqual(expect.arrayContaining(['A']))
  })
})

// ---------------------------------------------------------------------------
// validateDependencyGraph — missing dependency targets
// ---------------------------------------------------------------------------

describe('validateDependencyGraph — unknown dep ids', () => {
  it('returns { valid: false, error } containing the missing id', () => {
    const tasks: SeedTask[] = [{ id: 'A', depends_on: null }]
    const result = validateDependencyGraph('A', [hard('nonexistent')], makeDeps(tasks))
    expect(result).toMatchObject({ valid: false })
    expect('error' in result && result.error).toContain('nonexistent')
  })
})

// ---------------------------------------------------------------------------
// DependencyGraph.update() — live edge changes
// ---------------------------------------------------------------------------

describe('DependencyGraph.update()', () => {
  it('areDependenciesSatisfied reflects new deps after update()', () => {
    // Build graph with T depending on A (done)
    const graph = createDependencyIndex()
    graph.rebuild([
      { id: 'T', depends_on: [hard('A')] },
      { id: 'A', depends_on: null },
      { id: 'B', depends_on: null }
    ])

    // B is active — not yet satisfied
    const statusMap: Record<string, string> = { A: 'done', B: 'active' }
    const getStatus = (id: string) => statusMap[id]

    // Initially T depends on A (done) → satisfied
    const beforeUpdate = graph.areDependenciesSatisfied('T', [hard('A')], getStatus)
    expect(beforeUpdate.satisfied).toBe(true)

    // Replace T's deps with B (active) → now unsatisfied
    graph.update('T', [hard('B')])
    const afterUpdate = graph.areDependenciesSatisfied('T', [hard('B')], getStatus)
    expect(afterUpdate.satisfied).toBe(false)
    expect(afterUpdate.blockedBy).toContain('B')
  })

  it('update("T", null) removes T from A dependents set', () => {
    const graph = new DependencyGraph()
    graph.rebuild([
      { id: 'T', depends_on: [hard('A')] },
      { id: 'A', depends_on: null }
    ])

    // T depends on A — A's dependents should include T
    expect(graph.getDependents('A')).toContain('T')

    // Remove T's deps
    graph.update('T', null)
    expect(graph.getDependents('A')).not.toContain('T')
  })
})
