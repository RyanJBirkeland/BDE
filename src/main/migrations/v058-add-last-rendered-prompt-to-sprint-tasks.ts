import type Database from 'better-sqlite3'

export const version = 58
export const description = 'Add last_rendered_prompt column to sprint_tasks for prompt visibility'

export const up = (db: Database.Database): void => {
  const sql = `ALTER TABLE sprint_tasks ADD COLUMN last_rendered_prompt TEXT`
  db.exec(sql)
}
