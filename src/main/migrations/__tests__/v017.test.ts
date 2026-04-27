import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version, description } from '../v017-add'

type TaskRow = {
  id: string
  title: string
  prompt: string
  repo: string
  status: string
  priority: number
  depends_on: string | null
  spec: string | null
  notes: string | null
  pr_url: string | null
  pr_number: number | null
  pr_status: string | null
  pr_mergeable_state: string | null
  agent_run_id: string | null
  retry_count: number
  fast_fail_count: number
  started_at: string | null
  completed_at: string | null
  claimed_by: string | null
  template_name: string | null
  playground_enabled: number
  needs_review: number
  max_runtime_ms: number | null
  spec_type: string | null
  created_at: string
  updated_at: string
}

const V16_TASK_COLUMNS = [
  'id',
  'title',
  'prompt',
  'repo',
  'status',
  'priority',
  'depends_on',
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
  'playground_enabled',
  'needs_review',
  'max_runtime_ms',
  'spec_type',
  'created_at',
  'updated_at'
] as const

function createV16SprintTasksTable(db: Database.Database): void {
  // Mirrors the pre-v017 schema: v015 initial table + v016 spec_type column.
  // CHECK excludes 'branch_only' from pr_status (added by v017).
  const sql = `
    CREATE TABLE sprint_tasks (
      id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title               TEXT NOT NULL,
      prompt              TEXT NOT NULL DEFAULT '',
      repo                TEXT NOT NULL DEFAULT 'fleet',
      status              TEXT NOT NULL DEFAULT 'backlog'
                            CHECK(status IN ('backlog','queued','blocked','active','done','cancelled','failed','error')),
      priority            INTEGER NOT NULL DEFAULT 1,
      spec                TEXT,
      notes               TEXT,
      pr_url              TEXT,
      pr_number           INTEGER,
      pr_status           TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft')),
      pr_mergeable_state  TEXT,
      agent_run_id        TEXT,
      retry_count         INTEGER NOT NULL DEFAULT 0,
      fast_fail_count     INTEGER NOT NULL DEFAULT 0,
      started_at          TEXT,
      completed_at        TEXT,
      claimed_by          TEXT,
      template_name       TEXT,
      depends_on          TEXT,
      playground_enabled  INTEGER NOT NULL DEFAULT 0,
      needs_review        INTEGER NOT NULL DEFAULT 0,
      max_runtime_ms      INTEGER,
      spec_type           TEXT,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `
  db.exec(sql)
}

type SeedTaskOverrides = Partial<TaskRow> & Pick<TaskRow, 'id' | 'title' | 'status'>

function seedTask(db: Database.Database, overrides: SeedTaskOverrides): void {
  const row: TaskRow = {
    prompt: 'initial prompt',
    repo: 'fleet',
    priority: 1,
    depends_on: null,
    spec: null,
    notes: null,
    pr_url: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    agent_run_id: null,
    retry_count: 0,
    fast_fail_count: 0,
    started_at: null,
    completed_at: null,
    claimed_by: null,
    template_name: null,
    playground_enabled: 0,
    needs_review: 0,
    max_runtime_ms: null,
    spec_type: null,
    created_at: '2026-04-20T00:00:00.000Z',
    updated_at: '2026-04-20T00:00:00.000Z',
    ...overrides
  }
  const placeholders = V16_TASK_COLUMNS.map(() => '?').join(', ')
  const sql = `INSERT INTO sprint_tasks (${V16_TASK_COLUMNS.join(', ')}) VALUES (${placeholders})`
  db.prepare(sql).run(...V16_TASK_COLUMNS.map((col) => row[col]))
}

function selectTaskById(db: Database.Database, id: string): TaskRow {
  const sql = `SELECT ${V16_TASK_COLUMNS.join(', ')} FROM sprint_tasks WHERE id = ?`
  return db.prepare(sql).get(id) as TaskRow
}

describe('migration v017', () => {
  it('has version 17 and a non-placeholder description', () => {
    expect(version).toBe(17)
    expect(description).not.toMatch(/^Add\s*$/)
    expect(description.length).toBeGreaterThan(10)
  })

  it('preserves every seeded row with all columns intact after table rebuild', () => {
    const db = new Database(':memory:')
    createV16SprintTasksTable(db)

    const seedRows: TaskRow[] = [
      {
        id: 'task-queued',
        title: 'Queued task',
        prompt: 'do a thing',
        repo: 'fleet',
        status: 'queued',
        priority: 2,
        depends_on: '[{"id":"other","type":"hard"}]',
        spec: '## Goal\nsome spec',
        notes: 'notes here',
        pr_url: null,
        pr_number: null,
        pr_status: null,
        pr_mergeable_state: null,
        agent_run_id: null,
        retry_count: 0,
        fast_fail_count: 0,
        started_at: null,
        completed_at: null,
        claimed_by: null,
        template_name: 'Feature',
        playground_enabled: 0,
        needs_review: 1,
        max_runtime_ms: null,
        spec_type: 'feature',
        created_at: '2026-04-18T10:00:00.000Z',
        updated_at: '2026-04-18T10:00:00.000Z'
      },
      {
        id: 'task-active',
        title: 'Active task',
        prompt: 'running now',
        repo: 'fleet',
        status: 'active',
        priority: 3,
        depends_on: null,
        spec: null,
        notes: null,
        pr_url: null,
        pr_number: null,
        pr_status: null,
        pr_mergeable_state: null,
        agent_run_id: 'run-123',
        retry_count: 1,
        fast_fail_count: 0,
        started_at: '2026-04-19T12:00:00.000Z',
        completed_at: null,
        claimed_by: 'agent-42',
        template_name: null,
        playground_enabled: 1,
        needs_review: 0,
        max_runtime_ms: 600000,
        spec_type: 'prompt',
        created_at: '2026-04-19T11:30:00.000Z',
        updated_at: '2026-04-19T12:00:00.000Z'
      },
      {
        id: 'task-done',
        title: 'Done task',
        prompt: 'finished',
        repo: 'other-repo',
        status: 'done',
        priority: 1,
        depends_on: null,
        spec: '## Done\nwas completed',
        notes: 'wrap-up notes',
        pr_url: 'https://github.com/owner/other-repo/pull/7',
        pr_number: 7,
        pr_status: 'merged',
        pr_mergeable_state: 'clean',
        agent_run_id: 'run-9',
        retry_count: 0,
        fast_fail_count: 0,
        started_at: '2026-04-15T08:00:00.000Z',
        completed_at: '2026-04-15T09:00:00.000Z',
        claimed_by: 'agent-1',
        template_name: 'Bug Fix',
        playground_enabled: 0,
        needs_review: 0,
        max_runtime_ms: null,
        spec_type: 'spec',
        created_at: '2026-04-15T07:00:00.000Z',
        updated_at: '2026-04-15T09:00:00.000Z'
      }
    ]

    for (const row of seedRows) {
      seedTask(db, row)
    }

    up(db)

    for (const expected of seedRows) {
      const actual = selectTaskById(db, expected.id)
      expect(actual).toEqual(expected)
    }
    db.close()
  })

  it('allows inserting status=blocked after the rebuild', () => {
    const db = new Database(':memory:')
    createV16SprintTasksTable(db)
    up(db)

    expect(() =>
      db
        .prepare(
          `INSERT INTO sprint_tasks (id, title, status) VALUES ('task-blocked', 'Waiting on upstream', 'blocked')`
        )
        .run()
    ).not.toThrow()

    const row = selectTaskById(db, 'task-blocked')
    expect(row.status).toBe('blocked')
    db.close()
  })

  it('still rejects bogus statuses via CHECK after the rebuild', () => {
    const db = new Database(':memory:')
    createV16SprintTasksTable(db)
    up(db)

    expect(() =>
      db
        .prepare(
          `INSERT INTO sprint_tasks (id, title, status) VALUES ('task-bogus', 'Bad status', 'xyz_invalid')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/i)
    db.close()
  })

  it('recreates the updated_at trigger so updates bump updated_at', () => {
    const db = new Database(':memory:')
    createV16SprintTasksTable(db)
    seedTask(db, {
      id: 'task-trigger',
      title: 'Trigger target',
      status: 'queued',
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z'
    })

    up(db)

    db.prepare(`UPDATE sprint_tasks SET title = 'renamed' WHERE id = 'task-trigger'`).run()

    const row = selectTaskById(db, 'task-trigger')
    expect(row.title).toBe('renamed')
    expect(row.updated_at).not.toBe('2026-04-01T00:00:00.000Z')
    db.close()
  })
})
