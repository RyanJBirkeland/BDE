import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v056-add-is-paused-to-task-groups'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE task_groups (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'G',
      accent_color TEXT DEFAULT '#00ffcc',
      goal TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      depends_on TEXT DEFAULT NULL
    )
  `)
  return db
}

describe('migration v056', () => {
  it('has version 56', () => {
    expect(version).toBe(56)
  })

  it('adds is_paused column with default 0', () => {
    const db = makeDb()
    db.exec("INSERT INTO task_groups (name) VALUES ('My Epic')")

    up(db)

    const cols = (db.pragma('table_info(task_groups)') as Array<{ name: string }>).map(c => c.name)
    expect(cols).toContain('is_paused')

    const row = db.prepare('SELECT is_paused FROM task_groups LIMIT 1').get() as { is_paused: number }
    expect(row.is_paused).toBe(0)
    db.close()
  })

  it('new rows default to is_paused = 0', () => {
    const db = makeDb()
    up(db)
    db.exec("INSERT INTO task_groups (name) VALUES ('New Epic')")
    const row = db.prepare('SELECT is_paused FROM task_groups LIMIT 1').get() as { is_paused: number }
    expect(row.is_paused).toBe(0)
    db.close()
  })

  it('is idempotent — running twice does not throw', () => {
    const db = makeDb()
    expect(() => { up(db); up(db) }).not.toThrow()
    db.close()
  })
})
