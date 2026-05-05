import type Database from 'better-sqlite3'

export const version = 60
export const description = 'Add stacked_on_task_id to sprint_tasks and create pr_groups table'

export const up = (db: Database.Database): void => {
  const existingColumns = (db.pragma('table_info(sprint_tasks)') as Array<{ name: string }>).map(
    (c) => c.name
  )
  if (!existingColumns.includes('stacked_on_task_id')) {
    db.exec(`ALTER TABLE sprint_tasks ADD COLUMN stacked_on_task_id TEXT`)
  }

  const createPrGroupsTable = `
    CREATE TABLE IF NOT EXISTS pr_groups (
      id          TEXT PRIMARY KEY,
      repo        TEXT NOT NULL,
      title       TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'composing',
      task_order  TEXT NOT NULL DEFAULT '[]',
      pr_number   INTEGER,
      pr_url      TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `
  db.exec(createPrGroupsTable)
}
