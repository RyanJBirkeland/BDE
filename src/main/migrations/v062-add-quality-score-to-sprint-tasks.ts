import type Database from 'better-sqlite3'

export const version = 62
export const description = 'Add quality_score column to sprint_tasks for reviewer write-back'

export const up = (db: Database.Database): void => {
  const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
  if (!cols.includes('quality_score')) {
    db.exec(`ALTER TABLE sprint_tasks ADD COLUMN quality_score INTEGER`)
  }
}
