import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v049-add-index-sprint-tasks-group-id'

describe('migration v049', () => {
  it('has version 49', () => {
    expect(version).toBe(49)
  })

  it('creates idx_sprint_tasks_group_id on sprint_tasks(group_id)', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, group_id TEXT)`)

    up(db)

    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='index' AND name='idx_sprint_tasks_group_id'`
      )
      .get() as { name: string } | undefined

    expect(idx?.name).toBe('idx_sprint_tasks_group_id')
    db.close()
  })

  it('is idempotent (IF NOT EXISTS)', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, group_id TEXT)`)
    expect(() => {
      up(db)
      up(db)
    }).not.toThrow()
    db.close()
  })
})
