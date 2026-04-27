import { describe, it, expect } from 'vitest'
import { up, version, description } from '../v009-add-error-status-retry-count-fast-fail-count-to-sp'
import { makeMigrationTestDb } from './helpers'

describe('migration v009', () => {
  it('has version 9 and a meaningful description', () => {
    expect(version).toBe(9)
    expect(description.length).toBeGreaterThan(10)
  })

  it('adds retry_count and fast_fail_count columns with zero defaults for existing rows', () => {
    const db = makeMigrationTestDb(8)

    db.prepare(
      `INSERT INTO sprint_tasks (id, title, repo, status, priority)
       VALUES ('task-pre-v9', 'Legacy task', 'bde', 'queued', 1)`
    ).run()

    up(db)

    const row = db
      .prepare('SELECT retry_count, fast_fail_count FROM sprint_tasks WHERE id = ?')
      .get('task-pre-v9') as { retry_count: number; fast_fail_count: number }

    expect(row.retry_count).toBe(0)
    expect(row.fast_fail_count).toBe(0)
    db.close()
  })

  it('adds the error status to the CHECK constraint', () => {
    const db = makeMigrationTestDb(8)
    up(db)

    expect(() => {
      db.prepare(
        `INSERT INTO sprint_tasks (id, title, repo, status, priority)
         VALUES ('task-error', 'Error task', 'bde', 'error', 1)`
      ).run()
    }).not.toThrow()

    const row = db
      .prepare('SELECT status FROM sprint_tasks WHERE id = ?')
      .get('task-error') as { status: string }
    expect(row.status).toBe('error')
    db.close()
  })

  it('rejects statuses not in the v9 allow-list', () => {
    const db = makeMigrationTestDb(8)
    up(db)

    expect(() => {
      db.prepare(
        `INSERT INTO sprint_tasks (id, title, repo, status, priority)
         VALUES ('task-bad', 'Bad status', 'bde', 'not-a-real-status', 1)`
      ).run()
    }).toThrow()
    db.close()
  })

  it('is idempotent when applied on top of v008 schema', () => {
    const db = makeMigrationTestDb(8)
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
