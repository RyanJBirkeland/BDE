// src/main/migrations/v046-add-task-reviews-table.ts
import type Database from 'better-sqlite3'

export const version = 46
export const description = 'Add task_reviews table for AI Review Partner cache'

export const up: (db: Database.Database) => void = (db) => {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS task_reviews (
      task_id         TEXT    NOT NULL,
      commit_sha      TEXT    NOT NULL,
      quality_score   INTEGER NOT NULL,
      issues_count    INTEGER NOT NULL,
      files_count     INTEGER NOT NULL,
      opening_message TEXT    NOT NULL,
      findings_json   TEXT    NOT NULL,
      raw_response    TEXT    NOT NULL,
      model           TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      PRIMARY KEY (task_id, commit_sha)
    )`
  ).run()

  db.prepare('CREATE INDEX IF NOT EXISTS idx_task_reviews_task ON task_reviews(task_id)').run()
}
