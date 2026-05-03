import type Database from 'better-sqlite3'

export const version = 56
export const description = 'Add is_paused column to task_groups for drain-loop gating'

export const up = (db: Database.Database): void => {
  const cols = (db.pragma('table_info(task_groups)') as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('is_paused')) {
    db.exec('ALTER TABLE task_groups ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0')
  }
}
