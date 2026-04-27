import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v055-rename-bde-to-fleet-repo-column'

describe('migration v055', () => {
  it('has version 55', () => {
    expect(version).toBe(55)
  })

  it('renames repo bde → fleet and BDE → fleet', () => {
    const db = new Database(':memory:')
    db.prepare('CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, repo TEXT)').run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t1', 'bde')").run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t2', 'BDE')").run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t3', 'other')").run()

    up(db)

    const rows = db.prepare('SELECT id, repo FROM sprint_tasks ORDER BY id').all() as Array<{id: string; repo: string}>
    expect(rows.find(r => r.id === 't1')!.repo).toBe('fleet')
    expect(rows.find(r => r.id === 't2')!.repo).toBe('fleet')
    expect(rows.find(r => r.id === 't3')!.repo).toBe('other')
    db.close()
  })

  it('is a no-op when no bde rows exist', () => {
    const db = new Database(':memory:')
    db.prepare('CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, repo TEXT)').run()
    db.prepare("INSERT INTO sprint_tasks VALUES ('t1', 'fleet')").run()

    up(db)

    const row = db.prepare("SELECT repo FROM sprint_tasks WHERE id = 't1'").get() as {repo: string}
    expect(row.repo).toBe('fleet')
    db.close()
  })
})
