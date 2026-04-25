import type Database from 'better-sqlite3'

export const version = 53
export const description =
  'Add orphan_recovery_count column to sprint_tasks to cap infinite crash-loop recovery (EP-3)'

export const up: (db: Database.Database) => void = (db) => {
  db.prepare(
    'ALTER TABLE sprint_tasks ADD COLUMN orphan_recovery_count INTEGER NOT NULL DEFAULT 0'
  ).run()
}
