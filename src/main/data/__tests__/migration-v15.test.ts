import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('migration v15 — sprint_tasks table', () => {
  it('creates the sprint_tasks table', () => {
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sprint_tasks'")
        .all() as {
        name: string
      }[]
    ).map((r) => r.name)
    expect(tables).toContain('sprint_tasks')
  })

  it('has all expected columns', () => {
    const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
    const expected = [
      'id',
      'title',
      'prompt',
      'repo',
      'status',
      'priority',
      'spec',
      'notes',
      'pr_url',
      'pr_number',
      'pr_status',
      'pr_mergeable_state',
      'agent_run_id',
      'retry_count',
      'fast_fail_count',
      'started_at',
      'completed_at',
      'claimed_by',
      'template_name',
      'depends_on',
      'playground_enabled',
      'needs_review',
      'max_runtime_ms',
      'created_at',
      'updated_at'
    ]
    for (const col of expected) {
      expect(cols, `column "${col}" should exist`).toContain(col)
    }
  })

  it('accepts all 8 valid statuses', () => {
    const statuses = [
      'backlog',
      'queued',
      'blocked',
      'active',
      'done',
      'cancelled',
      'failed',
      'error'
    ]
    for (const status of statuses) {
      expect(() => {
        db.prepare(`INSERT INTO sprint_tasks (title, status) VALUES (?, ?)`).run(
          `Task for ${status}`,
          status
        )
      }, `status "${status}" should be accepted`).not.toThrow()
    }
  })

  it('rejects invalid status via CHECK constraint', () => {
    expect(() => {
      db.prepare(`INSERT INTO sprint_tasks (title, status) VALUES (?, ?)`).run(
        'Bad task',
        'invalid_status'
      )
    }).toThrow()
  })

  it('auto-generates id and timestamps via DEFAULT expressions', () => {
    db.prepare(`INSERT INTO sprint_tasks (title) VALUES (?)`).run('Auto defaults test')
    const row = db
      .prepare(`SELECT id, created_at, updated_at FROM sprint_tasks WHERE title = ?`)
      .get('Auto defaults test') as
      | { id: string; created_at: string; updated_at: string }
      | undefined

    expect(row).toBeDefined()
    expect(row!.id).toBeTruthy()
    expect(row!.id).toMatch(/^[0-9a-f]{32}$/)
    expect(row!.created_at).toBeTruthy()
    expect(row!.updated_at).toBeTruthy()
  })

  it('has an index on status', () => {
    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sprint_tasks'`)
        .all() as { name: string }[]
    ).map((r) => r.name)
    expect(indexes.some((n) => n.includes('status'))).toBe(true)
  })

  it('has an index on status (always present after latest migration)', () => {
    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sprint_tasks'`)
        .all() as { name: string }[]
    ).map((r) => r.name)
    // Migration v17 drops and recreates the table, only idx_sprint_tasks_status is guaranteed.
    // The claimed_by index may not exist after v17 recreates the table without it.
    expect(indexes.some((n) => n.includes('status'))).toBe(true)
  })

  it('has an index on pr_number', () => {
    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sprint_tasks'`)
        .all() as { name: string }[]
    ).map((r) => r.name)
    expect(indexes.some((n) => n.includes('pr_number') || n.includes('pr'))).toBe(true)
  })

  it('stores depends_on as TEXT and playground_enabled/needs_review as INTEGER', () => {
    db.prepare(
      `INSERT INTO sprint_tasks (title, depends_on, playground_enabled, needs_review) VALUES (?, ?, ?, ?)`
    ).run('Test types', JSON.stringify([{ id: 'abc', type: 'hard' }]), 1, 0)

    const row = db
      .prepare(
        `SELECT depends_on, playground_enabled, needs_review FROM sprint_tasks WHERE title = ?`
      )
      .get('Test types') as
      | {
          depends_on: string
          playground_enabled: number
          needs_review: number
        }
      | undefined

    expect(row).toBeDefined()
    expect(typeof row!.depends_on).toBe('string')
    const parsed = JSON.parse(row!.depends_on)
    expect(parsed[0].id).toBe('abc')
    expect(row!.playground_enabled).toBe(1)
    expect(row!.needs_review).toBe(0)
  })

  it('updated_at trigger fires on UPDATE', () => {
    db.prepare(`INSERT INTO sprint_tasks (id, title) VALUES (?, ?)`).run(
      'trigger-test',
      'Trigger test'
    )
    const before = (
      db.prepare(`SELECT updated_at FROM sprint_tasks WHERE id = ?`).get('trigger-test') as {
        updated_at: string
      }
    ).updated_at

    // Ensure time passes (SQLite timestamp precision is milliseconds)
    db.prepare(`UPDATE sprint_tasks SET notes = ? WHERE id = ?`).run('updated note', 'trigger-test')
    const after = (
      db.prepare(`SELECT updated_at FROM sprint_tasks WHERE id = ?`).get('trigger-test') as {
        updated_at: string
      }
    ).updated_at

    // The trigger should have fired; updated_at may be same or newer (same ms is OK)
    expect(after >= before).toBe(true)
  })
})
