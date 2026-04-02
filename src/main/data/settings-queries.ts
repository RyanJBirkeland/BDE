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

export function getSettingJson<T>(
  db: Database.Database,
  key: string,
  validator?: (value: unknown) => value is T
): T | null {
  const raw = getSetting(db, key)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    // DL-9: Optional validation to prevent unsafe deserialization
    if (validator && !validator(parsed)) {
      console.warn(`[settings-queries] Validation failed for setting "${key}"`)
      return null
    }
    return parsed as T
  } catch (err) {
    // DL-25: Log parse errors instead of swallowing silently
    console.warn(
      `[settings-queries] Failed to parse JSON for setting "${key}": ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

export function setSettingJson<T>(db: Database.Database, key: string, value: T): void {
  setSetting(db, key, JSON.stringify(value))
}
