/**
 * v028 creates the sprints table and adds sprint_id to sprint_tasks.
 */
import { describe, it, expect } from 'vitest'
import { up, version, description } from '../v028-add-sprints-table-and-sprint-id-to-sprint-tasks'
import { makeMigrationTestDb, tableExists, listTableColumns, indexExists } from './helpers'

describe('migration v028', () => {
  it('has version 28 and a meaningful description', () => {
    expect(version).toBe(28)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates the sprints table', () => {
    const db = makeMigrationTestDb(27)
    expect(tableExists(db, 'sprints')).toBe(false)

    up(db)

    expect(tableExists(db, 'sprints')).toBe(true)
    db.close()
  })

  it('creates the expected sprints columns', () => {
    const db = makeMigrationTestDb(27)
    up(db)

    const columns = listTableColumns(db, 'sprints')
    expect(columns).toContain('id')
    expect(columns).toContain('name')
    expect(columns).toContain('goal')
    expect(columns).toContain('start_date')
    expect(columns).toContain('end_date')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('updated_at')
    db.close()
  })

  it('adds sprint_id column to sprint_tasks', () => {
    const db = makeMigrationTestDb(27)
    const colsBefore = listTableColumns(db, 'sprint_tasks')
    expect(colsBefore).not.toContain('sprint_id')

    up(db)

    const colsAfter = listTableColumns(db, 'sprint_tasks')
    expect(colsAfter).toContain('sprint_id')
    db.close()
  })

  it('creates the idx_sprint_tasks_sprint index', () => {
    const db = makeMigrationTestDb(27)
    up(db)

    expect(indexExists(db, 'idx_sprint_tasks_sprint')).toBe(true)
    db.close()
  })

  it('accepts the valid sprint status values', () => {
    const db = makeMigrationTestDb(27)
    up(db)

    for (const status of ['planning', 'active', 'completed', 'cancelled']) {
      db.prepare(
        `INSERT INTO sprints (name, start_date, end_date, status) VALUES (?, '2026-01-01', '2026-01-14', ?)`
      ).run(`Sprint ${status}`, status)
    }

    const count = (db.prepare('SELECT COUNT(*) AS n FROM sprints').get() as { n: number }).n
    expect(count).toBe(4)
    db.close()
  })

  it('is idempotent — applying twice does not throw', () => {
    const db = makeMigrationTestDb(27)
    up(db)
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
