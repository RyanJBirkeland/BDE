import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v051-add-composite-index-on-sprint-tasks-pr-number-status'

function minimalDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(
    `CREATE TABLE sprint_tasks (
      id TEXT PRIMARY KEY,
      pr_number INTEGER,
      status TEXT
    )`
  )
  return db
}

describe('migration v051', () => {
  it('has version 51', () => {
    expect(version).toBe(51)
  })

  it('creates idx_sprint_tasks_pr_number_status after up(db)', () => {
    const db = minimalDb()
    up(db)
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='index' AND name='idx_sprint_tasks_pr_number_status'`
      )
      .get() as { name: string } | undefined
    expect(idx?.name).toBe('idx_sprint_tasks_pr_number_status')
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
