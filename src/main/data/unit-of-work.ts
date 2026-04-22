/**
 * Transaction abstraction for callers that must group several writes atomically
 * without importing the SQLite handle directly. Modules that hold an injected
 * `IAgentTaskRepository` should depend on this port instead of `getDb()`.
 */
import { getDb } from '../db'

export interface IUnitOfWork {
  runInTransaction(work: () => void): void
}

export function createUnitOfWork(): IUnitOfWork {
  return {
    runInTransaction(work) {
      const db = getDb()
      const tx = db.transaction(work)
      tx()
    }
  }
}
