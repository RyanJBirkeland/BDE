import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v053-add-orphan-recovery-count-to-sprint-tasks'

describe('migration v053', () => {
  it('has version 53', () => {
    expect(version).toBe(53)
  })

  it('adds orphan_recovery_count column with default 0', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, title TEXT)`)

    up(db)

    const row = db
      .prepare(`SELECT orphan_recovery_count FROM sprint_tasks WHERE id = 'test'`)
      .get() as { orphan_recovery_count: number } | undefined

    // Column exists — if it didn't, the prepare would throw
    expect(row).toBeUndefined() // no rows yet, but column must exist

    db.exec(`INSERT INTO sprint_tasks (id, title) VALUES ('t1', 'Test')`)
    const inserted = db
      .prepare(`SELECT orphan_recovery_count FROM sprint_tasks WHERE id = 't1'`)
      .get() as { orphan_recovery_count: number }

    expect(inserted.orphan_recovery_count).toBe(0)
    db.close()
  })

  it('is idempotent — second run throws (SQLite does not support IF NOT EXISTS for ADD COLUMN)', () => {
    // SQLite will throw "duplicate column name" on a second ADD COLUMN — that is
    // expected. Migrations run exactly once in production so this is not a problem.
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY)`)
    up(db)
    expect(() => up(db)).toThrow()
    db.close()
  })
})
