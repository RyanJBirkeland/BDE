import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v046-add-task-reviews-table'

describe('migration v046', () => {
  it('has version 46', () => {
    expect(version).toBe(46)
  })

  it('creates the task_reviews table with composite primary key', () => {
    const db = new Database(':memory:')

    up(db)

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='task_reviews'`)
      .get() as { name: string } | undefined

    expect(table?.name).toBe('task_reviews')

    // Verify composite PK by inserting a duplicate and expecting a constraint error
    db.prepare(
      `INSERT INTO task_reviews
       (task_id, commit_sha, quality_score, issues_count, files_count,
        opening_message, findings_json, raw_response, model, created_at)
       VALUES ('t-1', 'abc', 80, 2, 3, 'looks good', '{}', '{}', 'claude', 1000)`
    ).run()

    expect(() =>
      db.prepare(
        `INSERT INTO task_reviews
         (task_id, commit_sha, quality_score, issues_count, files_count,
          opening_message, findings_json, raw_response, model, created_at)
         VALUES ('t-1', 'abc', 90, 1, 2, 'retry', '{}', '{}', 'claude', 2000)`
      ).run()
    ).toThrow()

    db.close()
  })

  it('creates idx_task_reviews_task index on task_reviews(task_id)', () => {
    const db = new Database(':memory:')

    up(db)

    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_task_reviews_task'`
      )
      .get() as { name: string } | undefined

    expect(idx?.name).toBe('idx_task_reviews_task')
    db.close()
  })

  it('is idempotent via IF NOT EXISTS', () => {
    const db = new Database(':memory:')
    expect(() => {
      up(db)
      up(db)
    }).not.toThrow()
    db.close()
  })
})
