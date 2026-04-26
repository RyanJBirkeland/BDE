/**
 * T-140 — createUnitOfWork rollback behavior.
 *
 * The function is a thin wrapper around better-sqlite3's db.transaction().
 * Key behaviors:
 *   - Wraps the callback in a SQLite transaction (all-or-nothing).
 *   - If the callback throws, better-sqlite3 rolls back the transaction
 *     and re-throws the error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db'

vi.mock('../../db', async () => {
  const actual = await vi.importActual<typeof import('../../db')>('../../db')
  return { ...actual, getDb: () => db }
})

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
})

import { createUnitOfWork } from '../unit-of-work'

describe('createUnitOfWork', () => {
  it('commits work when the callback completes without throwing', () => {
    const uow = createUnitOfWork()
    db.prepare(`INSERT INTO sprint_tasks (title, repo, status) VALUES ('T1','bde','backlog')`).run()

    uow.runInTransaction(() => {
      db.prepare(`UPDATE sprint_tasks SET title='Updated' WHERE title='T1'`).run()
    })

    const row = db.prepare(`SELECT title FROM sprint_tasks WHERE repo='bde'`).get() as { title: string } | undefined
    expect(row?.title).toBe('Updated')
  })

  it('rolls back when the callback throws (T-140)', () => {
    const uow = createUnitOfWork()
    db.prepare(`INSERT INTO sprint_tasks (title, repo, status) VALUES ('T2','bde','backlog')`).run()

    expect(() => {
      uow.runInTransaction(() => {
        db.prepare(`UPDATE sprint_tasks SET title='ShouldRollback' WHERE title='T2'`).run()
        throw new Error('intentional rollback')
      })
    }).toThrow('intentional rollback')

    // Title must still be 'T2' — the UPDATE was rolled back
    const row = db.prepare(`SELECT title FROM sprint_tasks WHERE repo='bde'`).get() as { title: string } | undefined
    expect(row?.title).toBe('T2')
  })

  it('re-throws the error after rollback', () => {
    const uow = createUnitOfWork()
    const boom = new Error('boom')

    expect(() => {
      uow.runInTransaction(() => { throw boom })
    }).toThrow(boom)
  })
})
