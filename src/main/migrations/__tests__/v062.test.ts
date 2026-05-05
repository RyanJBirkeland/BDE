import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v062-add-quality-score-to-sprint-tasks'

describe('migration v062', () => {
  it('has version 62', () => {
    expect(version).toBe(62)
  })

  it('adds nullable quality_score column to sprint_tasks', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)`)
    db.exec(`INSERT INTO sprint_tasks (id, title) VALUES ('t1', 'Task one')`)

    up(db)

    const row = db.prepare('SELECT quality_score FROM sprint_tasks WHERE id = ?').get('t1') as {
      quality_score: number | null
    }
    expect(row.quality_score).toBeNull()
    db.close()
  })

  it('allows setting quality_score to an integer', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)`)
    db.exec(`INSERT INTO sprint_tasks (id, title) VALUES ('t1', 'Task one')`)
    up(db)

    db.prepare('UPDATE sprint_tasks SET quality_score = ? WHERE id = ?').run(88, 't1')

    const row = db.prepare('SELECT quality_score FROM sprint_tasks WHERE id = ?').get('t1') as {
      quality_score: number
    }
    expect(row.quality_score).toBe(88)
    db.close()
  })

  it('is idempotent (IF NOT EXISTS guard)', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)`)
    expect(() => {
      up(db)
      up(db)
    }).not.toThrow()
    db.close()
  })
})
