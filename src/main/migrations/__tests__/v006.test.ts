import { describe, it, expect } from 'vitest'
import { up, version, description } from '../v006-create-sprint-tasks-table-local-ownership'
import { makeMigrationTestDb, tableExists, indexExists } from './helpers'

describe('migration v006', () => {
  it('has version 6 and a meaningful description', () => {
    expect(version).toBe(6)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates the sprint_tasks table on top of v005 schema', () => {
    const db = makeMigrationTestDb(5)
    up(db)

    expect(tableExists(db, 'sprint_tasks')).toBe(true)
    expect(indexExists(db, 'idx_sprint_tasks_status')).toBe(true)
    db.close()
  })

  it('enforces the v6 status CHECK constraint', () => {
    const db = makeMigrationTestDb(5)
    up(db)

    expect(() => {
      db.prepare(
        `INSERT INTO sprint_tasks (id, title, status, priority) VALUES ('t1', 'x', 'invalid', 1)`
      ).run()
    }).toThrow()
    db.close()
  })

  it('accepts each allowed v6 status value', () => {
    const db = makeMigrationTestDb(5)
    up(db)

    for (const status of ['backlog', 'queued', 'active', 'done', 'cancelled', 'failed']) {
      expect(() => {
        db.prepare(
          `INSERT INTO sprint_tasks (id, title, status, priority) VALUES (?, 'x', ?, 1)`
        ).run(`task-${status}`, status)
      }).not.toThrow()
    }
    db.close()
  })

  it('enforces the pr_status CHECK constraint when set', () => {
    const db = makeMigrationTestDb(5)
    up(db)

    expect(() => {
      db.prepare(
        `INSERT INTO sprint_tasks (id, title, status, priority, pr_status)
         VALUES ('t-bad', 'x', 'queued', 1, 'bogus')`
      ).run()
    }).toThrow()

    expect(() => {
      db.prepare(
        `INSERT INTO sprint_tasks (id, title, status, priority, pr_status)
         VALUES ('t-ok', 'x', 'queued', 1, 'open')`
      ).run()
    }).not.toThrow()
    db.close()
  })

  it('is idempotent when applied twice on top of v005', () => {
    const db = makeMigrationTestDb(5)
    up(db)
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
