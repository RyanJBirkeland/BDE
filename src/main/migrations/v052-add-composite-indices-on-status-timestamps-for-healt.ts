import type Database from 'better-sqlite3'

export const version = 52
export const description =
  'Add composite indices on sprint_tasks(status, started_at) and (status, completed_at) to optimize health-check queries that filter on both columns'

export const up: (db: Database.Database) => void = (db) => {
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status_started_at ON sprint_tasks(status, started_at)'
  ).run()
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status_completed_at ON sprint_tasks(status, completed_at)'
  ).run()
}
