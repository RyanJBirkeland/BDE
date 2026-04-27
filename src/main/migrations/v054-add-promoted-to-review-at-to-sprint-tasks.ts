import type Database from 'better-sqlite3'

export const version = 54
export const description =
  'Add promoted_to_review_at column to sprint_tasks for nav badge watermark comparisons'

export const up: (db: Database.Database) => void = (db) => {
  db.prepare('ALTER TABLE sprint_tasks ADD COLUMN promoted_to_review_at TEXT').run()
}
