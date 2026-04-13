import type Database from 'better-sqlite3'

export const version = 49
export const description =
  'Add index on sprint_tasks(group_id) to speed up getGroupTasks() and related queries'

export const up: (db: Database.Database) => void = (db) => {
  const sql = `CREATE INDEX IF NOT EXISTS idx_sprint_tasks_group_id ON sprint_tasks(group_id)`
  db.exec(sql)
}
