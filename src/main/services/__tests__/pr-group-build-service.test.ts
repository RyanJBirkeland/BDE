import { describe, it, expect } from 'vitest'
import { topoSort } from '../pr-group-build-service'
import type { SprintTask } from '../../../shared/types/task-types'

function task(id: string, deps: string[] = []): SprintTask {
  return {
    id,
    title: id,
    depends_on: deps.map((depId) => ({ id: depId, type: 'hard' as const })),
  } as unknown as SprintTask
}

describe('topoSort', () => {
  it('returns a single task unchanged', () => {
    const t = task('a')
    expect(topoSort([t])).toEqual([t])
  })

  it('orders a task after its dependency', () => {
    const result = topoSort([task('b', ['a']), task('a')])
    expect(result.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('preserves input order when tasks have no inter-dependencies', () => {
    const result = topoSort([task('x'), task('y'), task('z')])
    expect(result.map((t) => t.id)).toEqual(['x', 'y', 'z'])
  })

  it('handles a linear chain A→B→C regardless of input order', () => {
    const result = topoSort([task('c', ['b']), task('a'), task('b', ['a'])])
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('handles a diamond dependency (A→B, A→C, B+C→D)', () => {
    const result = topoSort([task('d', ['b', 'c']), task('b', ['a']), task('c', ['a']), task('a')])
    const ids = result.map((t) => t.id)
    expect(ids[0]).toBe('a')
    expect(ids[ids.length - 1]).toBe('d')
    expect(ids).toHaveLength(4)
  })

  it('ignores dependency edges pointing to tasks outside the group', () => {
    // 'external' is not in the group — should not affect sort order
    const result = topoSort([task('b', ['external']), task('a')])
    // Both have in-degree 0 within the group, so input order is preserved
    expect(result.map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('returns all tasks even when a cycle exists (safety fallback)', () => {
    // Creation-time cycle detection prevents this in production, but the
    // fallback must never silently drop tasks.
    const result = topoSort([task('a', ['b']), task('b', ['a'])])
    expect(result).toHaveLength(2)
  })

  it('handles an empty input', () => {
    expect(topoSort([])).toEqual([])
  })
})
