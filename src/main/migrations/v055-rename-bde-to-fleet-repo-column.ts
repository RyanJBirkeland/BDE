import type Database from 'better-sqlite3'

export const version = 55
export const description = 'Rename sprint_tasks.repo values from bde/BDE to fleet'

export const up: (db: Database.Database) => void = (db) => {
  const sql = `UPDATE sprint_tasks SET repo = 'fleet' WHERE repo IN ('bde', 'BDE')`
  db.prepare(sql).run()
}
