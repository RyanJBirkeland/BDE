/**
 * v015 recreates the sprint_tasks table as a local SQLite table (migrating
 * back from Supabase). v012 dropped it, v015 restores it.
 */
import { describe, it, expect } from 'vitest'
import { up, version, description } from '../v015-recreate-sprint-tasks-table-migrating-back-from-su'
import { makeMigrationTestDb, tableExists, listTableColumns } from './helpers'

describe('migration v015', () => {
  it('has version 15 and a meaningful description', () => {
    expect(version).toBe(15)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates the sprint_tasks table when it does not exist (v012 dropped it)', () => {
    // v012 drops sprint_tasks; v015 re-creates it.
    const db = makeMigrationTestDb(14)
    expect(tableExists(db, 'sprint_tasks')).toBe(false)

    up(db)

    expect(tableExists(db, 'sprint_tasks')).toBe(true)
    db.close()
  })

  it('creates all expected columns in the new sprint_tasks schema', () => {
    const db = makeMigrationTestDb(14)
    up(db)

    const columns = listTableColumns(db, 'sprint_tasks')
    // spec_type is added by v016, not v015 — only assert what v015 creates
    const expected = [
      'id', 'title', 'prompt', 'repo', 'status', 'priority',
      'spec', 'notes', 'pr_url', 'pr_number', 'pr_status', 'pr_mergeable_state',
      'agent_run_id', 'retry_count', 'fast_fail_count',
      'started_at', 'completed_at', 'claimed_by', 'template_name', 'depends_on',
      'playground_enabled', 'needs_review', 'max_runtime_ms',
      'created_at', 'updated_at'
    ]
    for (const col of expected) {
      expect(columns).toContain(col)
    }
    db.close()
  })

  it('is idempotent (IF NOT EXISTS) when sprint_tasks already exists', () => {
    const db = makeMigrationTestDb(14)
    up(db)
    expect(() => up(db)).not.toThrow()
    db.close()
  })

  it('accepts the full set of sprint_tasks status values after recreation', () => {
    const db = makeMigrationTestDb(14)
    up(db)

    const validStatuses = ['backlog', 'queued', 'blocked', 'active', 'done', 'cancelled', 'failed', 'error']
    let idx = 0
    for (const status of validStatuses) {
      db.prepare(
        `INSERT INTO sprint_tasks (id, title, repo, status, priority) VALUES (?, ?, 'bde', ?, 1)`
      ).run(`task-${idx++}`, `Task for ${status}`, status)
    }

    const count = (db.prepare('SELECT COUNT(*) AS n FROM sprint_tasks').get() as { n: number }).n
    expect(count).toBe(validStatuses.length)
    db.close()
  })
})
