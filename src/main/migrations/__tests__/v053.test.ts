import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v053-add-orphan-recovery-count-to-sprint-tasks'

describe('migration v053', () => {
  it('has version 53', () => {
    expect(version).toBe(53)
  })

  it('adds orphan_recovery_count column with default 0', () => {
    const db = new Database(':memory:')
    db.prepare('CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, title TEXT)').run()

    up(db)

    const row = db
      .prepare('SELECT orphan_recovery_count FROM sprint_tasks WHERE id = ?')
      .get('test') as { orphan_recovery_count: number } | undefined

    expect(row).toBeUndefined()

    db.prepare('INSERT INTO sprint_tasks (id, title) VALUES (?, ?)').run('t1', 'Test')
    const inserted = db
      .prepare('SELECT orphan_recovery_count FROM sprint_tasks WHERE id = ?')
      .get('t1') as { orphan_recovery_count: number }

    expect(inserted.orphan_recovery_count).toBe(0)
    db.close()
  })

  it('is idempotent — second run throws (SQLite does not support IF NOT EXISTS for ADD COLUMN)', () => {
    const db = new Database(':memory:')
    db.prepare('CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY)').run()
    up(db)
    expect(() => up(db)).toThrow()
    db.close()
  })
})
