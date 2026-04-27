import type Database from 'better-sqlite3'

export const version = 5
export const description = 'Add source column to agent_runs'

export const up: (db: Database.Database) => void = (db) => {
  const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
  if (!cols.includes('source')) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'fleet'")
  }
}
