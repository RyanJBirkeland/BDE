import { describe, it, expect } from 'vitest'
import { parseTaskQuery, applyPredicates } from '../task-query'
import type { SprintTask } from '../../../../shared/types'

// Helper to create a minimal task for testing
function createTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'test-id',
    title: 'Test task',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'queued',
    notes: null,
    spec: null,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    template_name: null,
    depends_on: null,
    tags: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  }
}

describe('parseTaskQuery', () => {
  it('should parse empty query', () => {
    expect(parseTaskQuery('')).toEqual([])
    expect(parseTaskQuery('   ')).toEqual([])
  })

  it('should parse status filter', () => {
    const predicates = parseTaskQuery('status:failed')
    expect(predicates).toEqual([{ type: 'status', value: 'failed' }])
  })

  it('should parse repo filter', () => {
    const predicates = parseTaskQuery('repo:BDE')
    expect(predicates).toEqual([{ type: 'repo', value: 'BDE' }])
  })

  it('should parse tag filter', () => {
    const predicates = parseTaskQuery('tag:frontend')
    expect(predicates).toEqual([{ type: 'tag', value: 'frontend' }])
  })

  it('should parse priority with equals', () => {
    const predicates = parseTaskQuery('priority:2')
    expect(predicates).toEqual([{ type: 'priority', op: '=', value: 2 }])
  })

  it('should parse priority with less than or equal', () => {
    const predicates = parseTaskQuery('priority:<=2')
    expect(predicates).toEqual([{ type: 'priority', op: '<=', value: 2 }])
  })

  it('should parse priority with greater than', () => {
    const predicates = parseTaskQuery('priority:>1')
    expect(predicates).toEqual([{ type: 'priority', op: '>', value: 1 }])
  })

  it('should parse created date filter', () => {
    const predicates = parseTaskQuery('created:>7d')
    expect(predicates).toEqual([{ type: 'created', op: '>', value: 7 }])
  })

  it('should parse created date with less than', () => {
    const predicates = parseTaskQuery('created:<=30d')
    expect(predicates).toEqual([{ type: 'created', op: '<=', value: 30 }])
  })

  it('should parse free text search', () => {
    const predicates = parseTaskQuery('auth bug')
    expect(predicates).toEqual([
      { type: 'text', value: 'auth' },
      { type: 'text', value: 'bug' }
    ])
  })

  it('should parse quoted text as single token', () => {
    const predicates = parseTaskQuery('"auth bug"')
    expect(predicates).toEqual([{ type: 'text', value: 'auth bug' }])
  })

  it('should parse combined query', () => {
    const predicates = parseTaskQuery('status:failed priority:<=2 tag:frontend "auth"')
    expect(predicates).toEqual([
      { type: 'status', value: 'failed' },
      { type: 'priority', op: '<=', value: 2 },
      { type: 'tag', value: 'frontend' },
      { type: 'text', value: 'auth' }
    ])
  })

  it('should handle unknown fields as text', () => {
    const predicates = parseTaskQuery('unknown:value')
    expect(predicates).toEqual([{ type: 'text', value: 'unknown:value' }])
  })

  it('should ignore empty field values', () => {
    const predicates = parseTaskQuery('status:')
    expect(predicates).toEqual([])
  })

  it('should handle invalid priority format', () => {
    const predicates = parseTaskQuery('priority:abc')
    expect(predicates).toEqual([])
  })

  it('should handle invalid created format', () => {
    const predicates = parseTaskQuery('created:7')
    expect(predicates).toEqual([])
  })

  it('should normalize status to lowercase', () => {
    const predicates = parseTaskQuery('status:FAILED')
    expect(predicates).toEqual([{ type: 'status', value: 'failed' }])
  })
})

describe('applyPredicates', () => {
  it('should return all tasks when no predicates', () => {
    const tasks = [createTask(), createTask({ id: 'task-2' })]
    expect(applyPredicates(tasks, [])).toEqual(tasks)
  })

  it('should filter by status', () => {
    const tasks = [
      createTask({ id: '1', status: 'failed' }),
      createTask({ id: '2', status: 'queued' }),
      createTask({ id: '3', status: 'failed' })
    ]
    const predicates = parseTaskQuery('status:failed')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('should filter by repo', () => {
    const tasks = [
      createTask({ id: '1', repo: 'BDE' }),
      createTask({ id: '2', repo: 'repomap' }),
      createTask({ id: '3', repo: 'BDE' })
    ]
    const predicates = parseTaskQuery('repo:BDE')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('should filter by tag', () => {
    const tasks = [
      createTask({ id: '1', tags: ['frontend', 'ui'] }),
      createTask({ id: '2', tags: ['backend'] }),
      createTask({ id: '3', tags: ['frontend', 'auth'] })
    ]
    const predicates = parseTaskQuery('tag:frontend')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('should filter by priority equals', () => {
    const tasks = [
      createTask({ id: '1', priority: 1 }),
      createTask({ id: '2', priority: 2 }),
      createTask({ id: '3', priority: 1 })
    ]
    const predicates = parseTaskQuery('priority:1')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('should filter by priority less than or equal', () => {
    const tasks = [
      createTask({ id: '1', priority: 1 }),
      createTask({ id: '2', priority: 2 }),
      createTask({ id: '3', priority: 3 })
    ]
    const predicates = parseTaskQuery('priority:<=2')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['1', '2'])
  })

  it('should filter by priority greater than', () => {
    const tasks = [
      createTask({ id: '1', priority: 1 }),
      createTask({ id: '2', priority: 2 }),
      createTask({ id: '3', priority: 3 })
    ]
    const predicates = parseTaskQuery('priority:>1')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['2', '3'])
  })

  it('should filter by created date older than', () => {
    const now = new Date()
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)

    const tasks = [
      createTask({ id: '1', created_at: tenDaysAgo.toISOString() }),
      createTask({ id: '2', created_at: fiveDaysAgo.toISOString() }),
      createTask({ id: '3', created_at: now.toISOString() })
    ]
    const predicates = parseTaskQuery('created:>7d')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should filter by created date newer than', () => {
    const now = new Date()
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)

    const tasks = [
      createTask({ id: '1', created_at: tenDaysAgo.toISOString() }),
      createTask({ id: '2', created_at: fiveDaysAgo.toISOString() }),
      createTask({ id: '3', created_at: now.toISOString() })
    ]
    const predicates = parseTaskQuery('created:<=7d')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['2', '3'])
  })

  it('should filter by text in title (case insensitive)', () => {
    const tasks = [
      createTask({ id: '1', title: 'Fix auth bug' }),
      createTask({ id: '2', title: 'Add payment feature' }),
      createTask({ id: '3', title: 'Update AUTH documentation' })
    ]
    const predicates = parseTaskQuery('auth')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('should combine multiple predicates with AND logic', () => {
    const tasks = [
      createTask({ id: '1', status: 'failed', priority: 1, tags: ['frontend'] }),
      createTask({ id: '2', status: 'failed', priority: 3, tags: ['frontend'] }),
      createTask({ id: '3', status: 'failed', priority: 1, tags: ['backend'] }),
      createTask({ id: '4', status: 'queued', priority: 1, tags: ['frontend'] })
    ]
    const predicates = parseTaskQuery('status:failed priority:<=2 tag:frontend')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should handle tasks with null tags', () => {
    const tasks = [
      createTask({ id: '1', tags: null }),
      createTask({ id: '2', tags: ['frontend'] })
    ]
    const predicates = parseTaskQuery('tag:frontend')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('should handle complex quoted text search', () => {
    const tasks = [
      createTask({ id: '1', title: 'Fix auth bug in login' }),
      createTask({ id: '2', title: 'Add auth feature' }),
      createTask({ id: '3', title: 'Update documentation' })
    ]
    const predicates = parseTaskQuery('"auth bug"')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should handle multiple text predicates', () => {
    const tasks = [
      createTask({ id: '1', title: 'Fix auth bug in login' }),
      createTask({ id: '2', title: 'Add auth feature' }),
      createTask({ id: '3', title: 'Fix payment bug' })
    ]
    const predicates = parseTaskQuery('fix auth')
    const result = applyPredicates(tasks, predicates)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })
})
