import Database from 'better-sqlite3'
import { mkdirSync, existsSync, chmodSync, statSync, unlinkSync } from 'fs'
import path from 'path'
import { BDE_DIR as DB_DIR, BDE_DB_PATH as DB_PATH } from './paths'
import { getErrorMessage } from '../shared/errors'
import { loadMigrations, type Migration } from './migrations/loader'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(DB_DIR, { recursive: true, mode: 0o700 })
    // Enforce restrictive permissions on the .bde directory on every startup.
    // mkdirSync mode is only respected on creation — chmod fixes existing installs
    // that were created without the mode parameter.
    try {
      chmodSync(DB_DIR, 0o700)
    } catch (err) {
      // Non-fatal: log but continue — app can still function
      console.warn('[db] Failed to enforce .bde directory permissions:', err)
    }
    const dbExists = existsSync(DB_PATH)
    _db = new Database(DB_PATH)

    // DL-23: Set explicit file permissions (0600 = owner read/write only)
    if (!dbExists) {
      try {
        chmodSync(DB_PATH, 0o600)
      } catch (err) {
        console.error('[db] Failed to set database file permissions:', err)
      }
    }
    _db.pragma('journal_mode = WAL')
    _db.pragma('wal_autocheckpoint=200')
    _db.pragma('foreign_keys = ON')
    _db.pragma('synchronous = NORMAL')
    _db.pragma('cache_size = -8000')
    _db.pragma('busy_timeout = 5000')
    _db.pragma('temp_store = MEMORY')
    runMigrations(_db)
  }
  return _db
}

export function closeDb(): void {
  if (_db) {
    try {
      // DL-12: Checkpoint WAL to ensure durability on shutdown
      _db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (err) {
      console.error('[db] WAL checkpoint failed during close:', err)
    }
    _db.close()
    _db = null
  }
}

export function backupDatabase(): void {
  const db = getDb()
  const backupPath = DB_PATH + '.backup'

  // Validate backup path to prevent path traversal
  const resolvedPath = path.resolve(backupPath)
  const resolvedDbDir = path.resolve(DB_DIR)
  if (!resolvedPath.startsWith(resolvedDbDir)) {
    throw new Error('Invalid backup path: path traversal detected')
  }

  // Remove existing backup — VACUUM INTO does not overwrite
  if (existsSync(backupPath)) {
    unlinkSync(backupPath)
  }

  // VACUUM INTO doesn't support bound parameters, so we must use string interpolation.
  // Escape single quotes for SQLite string literal safety.
  const escapedPath = resolvedPath.replace(/'/g, "''")

  // DL-11: Propagate VACUUM INTO failures instead of swallowing
  const sql = `VACUUM INTO '${escapedPath}'`
  db.exec(sql)

  // DL-24: Verify backup integrity - check file exists and has reasonable size
  if (!existsSync(backupPath)) {
    throw new Error('Backup file was not created')
  }
  const backupSize = statSync(backupPath).size
  const originalSize = statSync(DB_PATH).size
  // Backup should be at least 10% of original size (VACUUM compresses)
  if (backupSize < originalSize * 0.1) {
    console.warn(
      `[db] Backup may be incomplete: ${backupSize} bytes (original: ${originalSize} bytes)`
    )
  }
}

// Migrations are loaded from individual files in src/main/migrations/
// To add a new migration:
// 1. Create a new file src/main/migrations/v###-description.ts (version = last + 1)
// 2. Export version, description, and up function
// 3. Never modify or reorder existing migrations
export const migrations: Migration[] = loadMigrations()

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)

  if (pending.length === 0) return

  // DL-8 & DL-19: Run migrations individually with error context
  for (const migration of pending) {
    try {
      const runSingle = db.transaction(() => {
        migration.up(db)
        db.prepare('PRAGMA user_version = ' + Math.trunc(Number(migration.version))).run()
      })
      runSingle()
    } catch (err) {
      const msg = getErrorMessage(err)
      throw new Error(`Migration v${migration.version} ("${migration.description}") failed: ${msg}`)
    }
  }
}
