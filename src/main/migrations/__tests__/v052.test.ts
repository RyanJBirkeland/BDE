import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v052-add-composite-indices-on-status-timestamps-for-healt'

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

describe('migration v052', () => {
  it('has version 52', () => {
    expect(version).toBe(52)
  })

  it('creates idx_sprint_tasks_status_started_at after up(db)', () => {
    const db = minimalDb()
    up(db)
    expect(getIndex(db, 'idx_sprint_tasks_status_started_at')?.name).toBe(
      'idx_sprint_tasks_status_started_at'
    )
    db.close()
  })

  it('creates idx_sprint_tasks_status_completed_at after up(db)', () => {
    const db = minimalDb()
    up(db)
    expect(getIndex(db, 'idx_sprint_tasks_status_completed_at')?.name).toBe(
      'idx_sprint_tasks_status_completed_at'
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
