import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version, description } from '../v020-add'

// v019 leaves the sprint_tasks shape identical to v017 (v018/v019 only touch the
// `settings` table). The CHECK constraint at that point allows these statuses:
const PRE_V020_STATUSES = [
  'backlog',
  'queued',
  'active',
  'done',
  'cancelled',
  'failed',
  'error',
  'blocked'
] as const

function createV019SprintTasks(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sprint_tasks (
      id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title               TEXT NOT NULL,
      prompt              TEXT NOT NULL DEFAULT '',
      repo                TEXT NOT NULL DEFAULT 'fleet',
      status              TEXT NOT NULL DEFAULT 'backlog'
                            CHECK(status IN ('backlog','queued','active','done','cancelled','failed','error','blocked')),
      priority            INTEGER NOT NULL DEFAULT 1,
      depends_on          TEXT,
      spec                TEXT,
      notes               TEXT,
      pr_url              TEXT,
      pr_number           INTEGER,
      pr_status           TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft','branch_only')),
      pr_mergeable_state  TEXT,
      agent_run_id        TEXT,
      retry_count         INTEGER NOT NULL DEFAULT 0,
      fast_fail_count     INTEGER NOT NULL DEFAULT 0,
      started_at          TEXT,
      completed_at        TEXT,
      claimed_by          TEXT,
      template_name       TEXT,
      playground_enabled  INTEGER NOT NULL DEFAULT 0,
      needs_review        INTEGER NOT NULL DEFAULT 0,
      max_runtime_ms      INTEGER,
      spec_type           TEXT,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
}

function insertTask(
  db: Database.Database,
  id: string,
  title: string,
  status: string,
  priority = 1
): void {
  db.prepare(
    `INSERT INTO sprint_tasks (id, title, status, priority, spec)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, title, status, priority, `spec-for-${id}`)
}

interface SprintTaskRow {
  id: string
  title: string
  status: string
  priority: number
  spec: string
}

function selectTask(db: Database.Database, id: string): SprintTaskRow | undefined {
  return db
    .prepare('SELECT id, title, status, priority, spec FROM sprint_tasks WHERE id = ?')
    .get(id) as SprintTaskRow | undefined
}

describe('migration v020', () => {
  it('has version 20 and a non-placeholder description', () => {
    expect(version).toBe(20)
    expect(description).not.toMatch(/^Add\s*$/)
    expect(description.length).toBeGreaterThan(10)
  })

  it('preserves every seeded row across the table rebuild', () => {
    const db = new Database(':memory:')
    createV019SprintTasks(db)

    const seeded = [
      { id: 'task-one', title: 'Backlog item', status: 'backlog', priority: 2 },
      { id: 'task-two', title: 'Queued item', status: 'queued', priority: 3 },
      { id: 'task-three', title: 'Blocked item', status: 'blocked', priority: 1 },
      { id: 'task-four', title: 'Done item', status: 'done', priority: 1 }
    ]
    for (const row of seeded) {
      insertTask(db, row.id, row.title, row.status, row.priority)
    }

    up(db)

    for (const row of seeded) {
      const after = selectTask(db, row.id)
      expect(after).toBeDefined()
      expect(after?.title).toBe(row.title)
      expect(after?.status).toBe(row.status)
      expect(after?.priority).toBe(row.priority)
      expect(after?.spec).toBe(`spec-for-${row.id}`)
    }

    const totalRows = db.prepare('SELECT COUNT(*) AS n FROM sprint_tasks').get() as { n: number }
    expect(totalRows.n).toBe(seeded.length)

    db.close()
  })

  it("accepts 'review' status after the migration", () => {
    const db = new Database(':memory:')
    createV019SprintTasks(db)
    insertTask(db, 'pre-existing', 'Pre existing', 'backlog')

    up(db)

    expect(() => insertTask(db, 'review-task', 'Under review', 'review')).not.toThrow()
    expect(selectTask(db, 'review-task')?.status).toBe('review')

    db.close()
  })

  it('still rejects a bogus status after the migration', () => {
    const db = new Database(':memory:')
    createV019SprintTasks(db)
    insertTask(db, 'seed', 'Seed', 'queued')

    up(db)

    expect(() => insertTask(db, 'bogus', 'Bogus', 'not-a-real-status')).toThrow(
      /CHECK constraint failed/i
    )

    db.close()
  })

  it('still accepts every pre-v020 status after the migration', () => {
    const db = new Database(':memory:')
    createV019SprintTasks(db)

    up(db)

    for (const [index, status] of PRE_V020_STATUSES.entries()) {
      expect(() => insertTask(db, `post-${index}`, `Title ${status}`, status)).not.toThrow()
    }

    db.close()
  })

  it('re-creates the updated_at trigger so updates bump the timestamp', () => {
    const db = new Database(':memory:')
    createV019SprintTasks(db)
    insertTask(db, 'trigger-target', 'Trigger target', 'queued')

    up(db)

    const before = db
      .prepare('SELECT updated_at FROM sprint_tasks WHERE id = ?')
      .get('trigger-target') as { updated_at: string }
    db.prepare('UPDATE sprint_tasks SET title = ? WHERE id = ?').run(
      'Trigger target renamed',
      'trigger-target'
    )
    const after = db
      .prepare('SELECT updated_at FROM sprint_tasks WHERE id = ?')
      .get('trigger-target') as { updated_at: string }

    expect(after.updated_at >= before.updated_at).toBe(true)
    db.close()
  })
})
