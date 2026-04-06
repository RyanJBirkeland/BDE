import { describe, it, expect } from 'vitest'
import { computeDagLayout, getNodeColor, getEdgeColor } from '../dag-layout'
import type { SprintTask } from '../../../../shared/types'

const makeTask = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  prompt: null,
  priority: 1,
  status: 'backlog',
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_mergeable_state: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides
})

describe('computeDagLayout', () => {
  it('returns empty layout for empty array', () => {
    const result = computeDagLayout([])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  it('positions a single task at origin + padding', () => {
    const tasks = [makeTask('t1')]
    const result = computeDagLayout(tasks)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('t1')
    expect(result.nodes[0].x).toBe(40) // PADDING
    expect(result.nodes[0].y).toBe(40) // PADDING
    expect(result.nodes[0].layer).toBe(0)
  })

  it('creates edges from dependencies', () => {
    const tasks = [
      makeTask('t1'),
      makeTask('t2', { depends_on: [{ id: 't1', type: 'hard' }] })
    ]
    const result = computeDagLayout(tasks)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toEqual({ from: 't1', to: 't2', type: 'hard' })
  })

  it('assigns dependent tasks to later layers', () => {
    const tasks = [
      makeTask('t1'),
      makeTask('t2', { depends_on: [{ id: 't1', type: 'hard' }] })
    ]
    const result = computeDagLayout(tasks)
    const t1Node = result.nodes.find((n) => n.id === 't1')!
    const t2Node = result.nodes.find((n) => n.id === 't2')!
    expect(t1Node.layer).toBe(0)
    expect(t2Node.layer).toBe(1)
    expect(t2Node.x).toBeGreaterThan(t1Node.x)
  })

  it('handles tasks with no dependencies in same layer', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')]
    const result = computeDagLayout(tasks)
    // All tasks should be in layer 0
    expect(result.nodes.every((n) => n.layer === 0)).toBe(true)
    // They should be spread vertically
    const ys = result.nodes.map((n) => n.y)
    expect(new Set(ys).size).toBe(3)
  })

  it('handles soft dependencies', () => {
    const tasks = [
      makeTask('t1'),
      makeTask('t2', { depends_on: [{ id: 't1', type: 'soft' }] })
    ]
    const result = computeDagLayout(tasks)
    expect(result.edges[0].type).toBe('soft')
  })

  it('ignores dependencies on tasks not in the set', () => {
    const tasks = [makeTask('t2', { depends_on: [{ id: 'missing', type: 'hard' }] })]
    const result = computeDagLayout(tasks)
    expect(result.edges).toHaveLength(0)
    expect(result.nodes).toHaveLength(1)
  })

  it('handles diamond dependency pattern', () => {
    const tasks = [
      makeTask('t1'),
      makeTask('t2', { depends_on: [{ id: 't1', type: 'hard' }] }),
      makeTask('t3', { depends_on: [{ id: 't1', type: 'hard' }] }),
      makeTask('t4', {
        depends_on: [
          { id: 't2', type: 'hard' },
          { id: 't3', type: 'hard' }
        ]
      })
    ]
    const result = computeDagLayout(tasks)
    expect(result.nodes).toHaveLength(4)
    expect(result.edges).toHaveLength(4)

    const t1 = result.nodes.find((n) => n.id === 't1')!
    const t4 = result.nodes.find((n) => n.id === 't4')!
    expect(t4.layer).toBeGreaterThan(t1.layer)
  })

  it('computes width and height from layout', () => {
    const tasks = [makeTask('t1')]
    const result = computeDagLayout(tasks)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })
})

describe('getNodeColor', () => {
  it('returns appropriate colors for each status', () => {
    expect(getNodeColor('backlog')).toContain('dim')
    expect(getNodeColor('queued')).toContain('cyan')
    expect(getNodeColor('blocked')).toContain('orange')
    expect(getNodeColor('active')).toContain('purple')
    expect(getNodeColor('review')).toContain('blue')
    expect(getNodeColor('done')).toContain('pink')
    expect(getNodeColor('cancelled')).toContain('red')
    expect(getNodeColor('failed')).toContain('red')
    expect(getNodeColor('error')).toContain('red')
  })

  it('returns dim color for unknown status', () => {
    expect(getNodeColor('unknown' as any)).toContain('dim')
  })
})

describe('getEdgeColor', () => {
  it('returns purple for hard edges', () => {
    expect(getEdgeColor('hard')).toContain('purple')
  })

  it('returns dim for soft edges', () => {
    expect(getEdgeColor('soft')).toContain('dim')
  })
})
