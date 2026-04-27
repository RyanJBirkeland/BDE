import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v050-add-indices-on-started-at-and-completed-at'

function minimalDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(
    `CREATE TABLE sprint_tasks (
      id TEXT PRIMARY KEY,
      status TEXT,
      started_at TEXT,
      completed_at TEXT
    )`
  )
  return db
}

function getIndex(db: Database.Database, name: string): { name: string } | undefined {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(name) as { name: string } | undefined
}

describe('migration v050', () => {
  it('has version 50', () => {
    expect(version).toBe(50)
  })

  it('creates idx_sprint_tasks_started_at after up(db)', () => {
    const db = minimalDb()
    up(db)
    expect(getIndex(db, 'idx_sprint_tasks_started_at')?.name).toBe('idx_sprint_tasks_started_at')
    db.close()
  })

  it('creates idx_sprint_tasks_completed_at after up(db)', () => {
    const db = minimalDb()
    up(db)
    expect(getIndex(db, 'idx_sprint_tasks_completed_at')?.name).toBe(
      'idx_sprint_tasks_completed_at'
    )
    db.close()
  })

  it('is idempotent via IF NOT EXISTS', () => {
    const db = minimalDb()
    expect(() => {
      up(db)
      up(db)
    }).not.toThrow()
    db.close()
  })
})
