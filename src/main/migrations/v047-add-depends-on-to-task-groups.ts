import type Database from 'better-sqlite3'

export const version = 47
export const description = 'Add depends_on column to task_groups table'

export const up: (db: Database.Database) => void = (db) => {
  // Add depends_on column to task_groups if it doesn't exist
  const cols = (db.pragma('table_info(task_groups)') as { name: string }[]).map((c) => c.name)
  if (!cols.includes('depends_on')) {
    const sql = 'ALTER TABLE task_groups ADD COLUMN depends_on TEXT DEFAULT NULL'
    db.exec(sql)
  }
}
