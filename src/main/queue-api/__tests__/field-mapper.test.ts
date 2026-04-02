import { describe, it, expect } from 'vitest'
import { toCamelCase, toSnakeCase } from '../field-mapper'

describe('field-mapper', () => {
  const snakeRow = {
    id: 'abc',
    title: 'Test',
    prompt: 'Do thing',
    repo: 'bde',
    status: 'queued',
    priority: 1,
    spec: null,
    notes: null,
    depends_on: null,
    pr_url: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    agent_run_id: null,
    retry_count: 0,
    fast_fail_count: 0,
    repo_path: '/tmp/repo',
    gh_repo: 'org/repo',
    started_at: null,
    completed_at: null,
    claimed_by: null,
    template_name: null,
    max_runtime_ms: null,
    needs_review: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01'
  }

  it('converts snake_case row to camelCase SprintTask', () => {
    const result = toCamelCase(snakeRow)
    expect(result.agentRunId).toBeNull()
    expect(result.prUrl).toBeNull()
    expect(result.retryCount).toBe(0)
    expect(result.fastFailCount).toBe(0)
    expect(result.repoPath).toBe('/tmp/repo')
    expect(result.ghRepo).toBe('org/repo')
    expect(result.dependsOn).toBeNull()
    expect(result.prMergeableState).toBeNull()
  })

  it('converts camelCase fields to snake_case', () => {
    const result = toSnakeCase({ prUrl: 'https://...', retryCount: 2, fastFailCount: 1 })
    expect(result).toEqual({ pr_url: 'https://...', retry_count: 2, fast_fail_count: 1 })
  })

  it('round-trips correctly', () => {
    const camel = toCamelCase(snakeRow)
    const snake = toSnakeCase(camel)
    expect(snake.pr_url).toBe(snakeRow.pr_url)
    expect(snake.agent_run_id).toBe(snakeRow.agent_run_id)
  })

  it('parses stringified JSONB depends_on field', () => {
    const rowWithStringDeps = {
      ...snakeRow,
      depends_on: '[{"id":"task-1","type":"hard"},{"id":"task-2","type":"soft"}]'
    }
    const result = toCamelCase(rowWithStringDeps)
    expect(result.dependsOn).toEqual([
      { id: 'task-1', type: 'hard' },
      { id: 'task-2', type: 'soft' }
    ])
  })

  it('preserves properly parsed depends_on array', () => {
    const rowWithArrayDeps = {
      ...snakeRow,
      depends_on: [
        { id: 'task-1', type: 'hard' },
        { id: 'task-2', type: 'soft' }
      ]
    }
    const result = toCamelCase(rowWithArrayDeps)
    expect(result.dependsOn).toEqual([
      { id: 'task-1', type: 'hard' },
      { id: 'task-2', type: 'soft' }
    ])
  })

  it('handles null depends_on', () => {
    const result = toCamelCase(snakeRow)
    expect(result.dependsOn).toBeNull()
  })

  it('handles malformed depends_on string gracefully', () => {
    const rowWithBadDeps = {
      ...snakeRow,
      depends_on: 'not-valid-json'
    }
    const result = toCamelCase(rowWithBadDeps)
    // Should return null for malformed data (defensive sanitization)
    expect(result.dependsOn).toBeNull()
  })

  it('handles empty string depends_on', () => {
    const rowWithEmptyDeps = {
      ...snakeRow,
      depends_on: ''
    }
    const result = toCamelCase(rowWithEmptyDeps)
    expect(result.dependsOn).toBeNull()
  })

  it('handles empty array depends_on', () => {
    const rowWithEmptyArray = {
      ...snakeRow,
      depends_on: []
    }
    const result = toCamelCase(rowWithEmptyArray)
    expect(result.dependsOn).toBeNull()
  })

  it('filters out invalid dependencies', () => {
    const rowWithMixedDeps = {
      ...snakeRow,
      depends_on: [
        { id: 'task-1', type: 'hard' },
        { id: '', type: 'soft' }, // Invalid: empty id
        { type: 'hard' }, // Invalid: missing id
        { id: 'task-2', type: 'invalid' }, // Invalid: wrong type
        { id: 'task-3', type: 'soft' }
      ]
    }
    const result = toCamelCase(rowWithMixedDeps)
    // Should only keep valid dependencies
    expect(result.dependsOn).toEqual([
      { id: 'task-1', type: 'hard' },
      { id: 'task-3', type: 'soft' }
    ])
  })

  it('returns null if all dependencies are invalid', () => {
    const rowWithAllInvalidDeps = {
      ...snakeRow,
      depends_on: [{ id: '', type: 'soft' }, { type: 'hard' }, { id: 'task-1', type: 'invalid' }]
    }
    const result = toCamelCase(rowWithAllInvalidDeps)
    expect(result.dependsOn).toBeNull()
  })

  it('toSnakeCase serializes dependsOn array to JSON string for SQLite', () => {
    const camelRow = {
      dependsOn: [{ id: 'task-1', type: 'hard' }],
      prUrl: 'https://github.com/org/repo/pull/1'
    }
    const result = toSnakeCase(camelRow)
    expect(result.depends_on).toBe(JSON.stringify([{ id: 'task-1', type: 'hard' }]))
    expect(result.pr_url).toBe('https://github.com/org/repo/pull/1')
  })
})
