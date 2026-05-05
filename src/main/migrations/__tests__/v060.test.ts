import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v060-add-stacked-on-task-id-and-pr-groups'

const createMinimalSprintTasksTable = (db: Database.Database): void => {
  db.exec(
    `CREATE TABLE sprint_tasks (
      id      TEXT PRIMARY KEY,
      title   TEXT NOT NULL,
      status  TEXT NOT NULL DEFAULT 'backlog',
      repo    TEXT NOT NULL DEFAULT ''
    )`
  )
}

describe('migration v059', () => {
  it('has version 59', () => {
    expect(version).toBe(60)
  })

  it('adds stacked_on_task_id column to sprint_tasks', () => {
    const db = new Database(':memory:')
    createMinimalSprintTasksTable(db)

    up(db)

    const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('stacked_on_task_id')
    db.close()
  })

  it('creates the pr_groups table with all expected columns', () => {
    const db = new Database(':memory:')
    createMinimalSprintTasksTable(db)

    up(db)

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pr_groups'`)
      .get() as { name: string } | undefined

    expect(table?.name).toBe('pr_groups')

    const cols = (db.pragma('table_info(pr_groups)') as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('id')
    expect(cols).toContain('repo')
    expect(cols).toContain('title')
    expect(cols).toContain('branch_name')
    expect(cols).toContain('description')
    expect(cols).toContain('status')
    expect(cols).toContain('task_order')
    expect(cols).toContain('pr_number')
    expect(cols).toContain('pr_url')
    expect(cols).toContain('created_at')
    expect(cols).toContain('updated_at')
    db.close()
  })

  it('pr_groups.status defaults to composing', () => {
    const db = new Database(':memory:')
    createMinimalSprintTasksTable(db)

    up(db)

    db.prepare(
      `INSERT INTO pr_groups (id, repo, title, branch_name, created_at, updated_at)
       VALUES ('pg-1', 'fleet', 'Stack PR', 'stack/test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    ).run()

    const row = db.prepare(`SELECT status, task_order FROM pr_groups WHERE id = 'pg-1'`).get() as {
      status: string
      task_order: string
    }

    expect(row.status).toBe('composing')
    expect(row.task_order).toBe('[]')
    db.close()
  })

  it('is idempotent — calling up twice does not throw', () => {
    const db = new Database(':memory:')
    createMinimalSprintTasksTable(db)

    expect(() => {
      up(db)
      up(db)
    }).not.toThrow()
    db.close()
  })

  it('is idempotent when stacked_on_task_id already exists on sprint_tasks', () => {
    const db = new Database(':memory:')
    db.exec(
      `CREATE TABLE sprint_tasks (
        id                  TEXT PRIMARY KEY,
        title               TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'backlog',
        repo                TEXT NOT NULL DEFAULT '',
        stacked_on_task_id  TEXT
      )`
    )

    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
