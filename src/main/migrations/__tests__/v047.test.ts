import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v047-add-depends-on-to-task-groups'

describe('migration v047', () => {
  it('has version 47', () => {
    expect(version).toBe(47)
  })

  it('adds depends_on column to task_groups', () => {
    const db = new Database(':memory:')
    db.exec(
      `CREATE TABLE task_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'draft'
      )`
    )

    up(db)

    const cols = (db.pragma('table_info(task_groups)') as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('depends_on')
    db.close()
  })

  it('preserves pre-existing rows with depends_on = NULL', () => {
    const db = new Database(':memory:')
    db.exec(
      `CREATE TABLE task_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'draft'
      )`
    )
    db.prepare(`INSERT INTO task_groups (id, name) VALUES ('g-1', 'Epic One')`).run()

    up(db)

    const row = db
      .prepare(`SELECT * FROM task_groups WHERE id = 'g-1'`)
      .get() as { id: string; name: string; depends_on: string | null }

    expect(row.id).toBe('g-1')
    expect(row.name).toBe('Epic One')
    expect(row.depends_on).toBeNull()
    db.close()
  })

  it('is idempotent when column already exists', () => {
    const db = new Database(':memory:')
    db.exec(
      `CREATE TABLE task_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        depends_on TEXT DEFAULT NULL
      )`
    )

    // Should not throw — the migration guards with a column-existence check
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
