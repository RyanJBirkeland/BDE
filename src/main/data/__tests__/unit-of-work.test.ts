import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db'

// In-memory SQLite instance shared across tests in this file.
let db: Database.Database

// Override getDb so createUnitOfWork uses our in-memory DB — not the live user DB.
vi.mock('../../db', async () => {
  const actual = await vi.importActual<typeof import('../../db')>('../../db')
  return {
    ...actual,
    getDb: () => db
  }
})

// Import after mocks are set up so the module sees the mocked getDb.
import { createUnitOfWork } from '../unit-of-work'

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

// Minimal columns sufficient for an insert without touching nullable fields
// that future migrations may add non-null constraints to.
function insertTaskRow(id: string): void {
  const sql = `
    INSERT INTO sprint_tasks (id, title, status, repo, priority, needs_review)
    VALUES (?, 'test task', 'backlog', 'bde', 1, 0)
  `
  db.prepare(sql).run(id)
}

function countTasksById(id: string): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM sprint_tasks WHERE id = ?').get(id) as {
    n: number
  }
  return row.n
}

describe('createUnitOfWork', () => {
  describe('runInTransaction', () => {
    it('commits the insert when work completes without throwing', () => {
      const uow = createUnitOfWork()
      const taskId = 'uow-commit-test'

      uow.runInTransaction(() => insertTaskRow(taskId))

      expect(countTasksById(taskId)).toBe(1)
    })

    it('rolls back the insert when work throws', () => {
      const uow = createUnitOfWork()
      const taskId = 'uow-rollback-test'

      try {
        uow.runInTransaction(() => {
          insertTaskRow(taskId)
          throw new Error('simulated failure')
        })
      } catch {
        // Expected — the error propagates; we only care about DB state here.
      }

      expect(countTasksById(taskId)).toBe(0)
    })

    it('re-throws the error to the caller', () => {
      const uow = createUnitOfWork()

      expect(() =>
        uow.runInTransaction(() => {
          throw new Error('simulated failure')
        })
      ).toThrow('simulated failure')
    })
  })
})
