import { describe, it, expect } from 'vitest'
import { matchesSearch } from '../../components/sprint/SprintTaskList'
import type { SprintTask } from '../../../../shared/types'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Implement OAuth login',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'active',
    notes: 'Blocked on design review',
    spec: 'Add Google OAuth2 flow to the auth module',
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
    updated_at: '2024-03-20T10:00:00Z',
    created_at: '2024-03-20T09:00:00Z',
    ...overrides,
  } as SprintTask
}

describe('matchesSearch', () => {
  it('returns true when query is empty', () => {
    expect(matchesSearch(makeTask(), '')).toBe(true)
  })

  it('matches against title (case-insensitive)', () => {
    expect(matchesSearch(makeTask(), 'oauth')).toBe(true)
    expect(matchesSearch(makeTask(), 'OAUTH')).toBe(true)
  })

  it('matches against spec content', () => {
    expect(matchesSearch(makeTask(), 'Google OAuth2')).toBe(true)
  })

  it('matches against notes content', () => {
    expect(matchesSearch(makeTask(), 'design review')).toBe(true)
  })

  it('does not match when query is absent from all fields', () => {
    expect(matchesSearch(makeTask(), 'kubernetes')).toBe(false)
  })

  it('handles null spec gracefully', () => {
    const task = makeTask({ spec: null })
    expect(matchesSearch(task, 'Google')).toBe(false)
    expect(matchesSearch(task, 'OAuth')).toBe(true) // still in title
  })

  it('handles null notes gracefully', () => {
    const task = makeTask({ notes: null })
    expect(matchesSearch(task, 'design')).toBe(false)
    expect(matchesSearch(task, 'OAuth')).toBe(true) // still in title
  })

  it('handles task with all null optional fields', () => {
    const task = makeTask({ spec: null, notes: null })
    expect(matchesSearch(task, 'Implement')).toBe(true)
    expect(matchesSearch(task, 'nonexistent')).toBe(false)
  })
})
