import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  up,
  version,
  description
} from '../v038-normalize-sprint-tasks-repo-to-lowercase-for-case-'

function makeTasksTable(db: Database.Database): void {
  db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, title TEXT, repo TEXT, notes TEXT)`)
}

function insertTask(
  db: Database.Database,
  id: string,
  repo: string,
  title = 't',
  notes = 'n'
): void {
  db.prepare('INSERT INTO sprint_tasks (id, title, repo, notes) VALUES (?, ?, ?, ?)').run(
    id,
    title,
    repo,
    notes
  )
}

function selectRepo(db: Database.Database, id: string): string {
  const row = db.prepare('SELECT repo FROM sprint_tasks WHERE id = ?').get(id) as { repo: string }
  return row.repo
}

describe('migration v038', () => {
  it('has version 38 and a non-placeholder description', () => {
    expect(version).toBe(38)
    expect(description).not.toMatch(/^Add\s*$/)
    expect(description.length).toBeGreaterThan(10)
  })

  it('lowercases rows with any uppercase characters in repo', () => {
    const db = new Database(':memory:')
    makeTasksTable(db)
    insertTask(db, 'a', 'BDE')
    insertTask(db, 'b', 'Bde')
    insertTask(db, 'c', 'MixedCase')

    up(db)

    expect(selectRepo(db, 'a')).toBe('bde')
    expect(selectRepo(db, 'b')).toBe('bde')
    expect(selectRepo(db, 'c')).toBe('mixedcase')
    db.close()
  })

  it('is a no-op when every repo is already lowercase', () => {
    const db = new Database(':memory:')
    makeTasksTable(db)
    insertTask(db, 'a', 'bde')
    insertTask(db, 'b', 'other-repo')

    const stmt = db.prepare('UPDATE sprint_tasks SET repo = lower(repo) WHERE repo <> lower(repo)')
    const info = stmt.run()
    expect(info.changes).toBe(0)

    // Migration itself should also be safe to apply on already-normalized data.
    expect(() => up(db)).not.toThrow()
    expect(selectRepo(db, 'a')).toBe('bde')
    expect(selectRepo(db, 'b')).toBe('other-repo')
    db.close()
  })

  it('is idempotent (applying twice produces the same result)', () => {
    const db = new Database(':memory:')
    makeTasksTable(db)
    insertTask(db, 'a', 'BDE')

    up(db)
    up(db)

    expect(selectRepo(db, 'a')).toBe('bde')
    db.close()
  })

  it('does not touch unrelated columns', () => {
    const db = new Database(':memory:')
    makeTasksTable(db)
    insertTask(db, 'a', 'BDE', 'MyTitle-MixedCase', 'Notes-With-Case')

    up(db)

    const row = db.prepare('SELECT title, notes FROM sprint_tasks WHERE id = ?').get('a') as {
      title: string
      notes: string
    }
    expect(row.title).toBe('MyTitle-MixedCase')
    expect(row.notes).toBe('Notes-With-Case')
    db.close()
  })
})
