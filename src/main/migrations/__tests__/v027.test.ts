/**
 * v027 creates task_groups and adds group_id to sprint_tasks.
 */
import { describe, it, expect } from 'vitest'
import { up, version, description } from '../v027-create-task-groups-table-and-add-group-id-to-sprin'
import { makeMigrationTestDb, tableExists, listTableColumns, indexExists } from './helpers'

describe('migration v027', () => {
  it('has version 27 and a meaningful description', () => {
    expect(version).toBe(27)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates the task_groups table', () => {
    const db = makeMigrationTestDb(26)
    expect(tableExists(db, 'task_groups')).toBe(false)

    up(db)

    expect(tableExists(db, 'task_groups')).toBe(true)
    db.close()
  })

  it('creates all expected task_groups columns', () => {
    const db = makeMigrationTestDb(26)
    up(db)

    const columns = listTableColumns(db, 'task_groups')
    expect(columns).toContain('id')
    expect(columns).toContain('name')
    expect(columns).toContain('icon')
    expect(columns).toContain('accent_color')
    expect(columns).toContain('goal')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('updated_at')
    db.close()
  })

  it('adds group_id column to sprint_tasks', () => {
    const db = makeMigrationTestDb(26)
    const colsBefore = listTableColumns(db, 'sprint_tasks')
    expect(colsBefore).not.toContain('group_id')

    up(db)

    const colsAfter = listTableColumns(db, 'sprint_tasks')
    expect(colsAfter).toContain('group_id')
    db.close()
  })

  it('creates the idx_sprint_tasks_group index', () => {
    const db = makeMigrationTestDb(26)
    up(db)

    expect(indexExists(db, 'idx_sprint_tasks_group')).toBe(true)
    db.close()
  })

  it('accepts valid task_groups status values', () => {
    const db = makeMigrationTestDb(26)
    up(db)

    for (const status of ['draft', 'ready', 'in-pipeline', 'completed']) {
      db.prepare(`INSERT INTO task_groups (name, status) VALUES (?, ?)`).run(`Group ${status}`, status)
    }

    const count = (db.prepare('SELECT COUNT(*) AS n FROM task_groups').get() as { n: number }).n
    expect(count).toBe(4)
    db.close()
  })

  it('is idempotent — applying twice does not throw', () => {
    const db = makeMigrationTestDb(26)
    up(db)
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
