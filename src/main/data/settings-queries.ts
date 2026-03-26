/**
 * Settings query functions — extracted from settings.ts.
 * All functions take `db: Database.Database` as first parameter for testability.
 */
import type Database from 'better-sqlite3'

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value)
}

export function deleteSetting(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function getSettingJson<T>(db: Database.Database, key: string): T | null {
  const raw = getSetting(db, key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function setSettingJson<T>(db: Database.Database, key: string, value: T): void {
  setSetting(db, key, JSON.stringify(value))
}
