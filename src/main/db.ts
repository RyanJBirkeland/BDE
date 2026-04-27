import Database from 'better-sqlite3'
import { mkdirSync, existsSync, chmodSync, statSync, unlinkSync } from 'fs'
import path from 'path'
import { BDE_DIR as DB_DIR, BDE_DB_PATH as DB_PATH, BDE_TASK_MEMORY_DIR } from './paths'
import { getErrorMessage } from '../shared/errors'
import { loadMigrations, getPendingMigrations, type Migration } from './migrations/loader'
import { createLogger } from './logger'

const log = createLogger('db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(DB_DIR, { recursive: true, mode: 0o700 })
    mkdirSync(BDE_TASK_MEMORY_DIR, { recursive: true })
    // Enforce restrictive permissions on the .bde directory on every startup.
    // mkdirSync mode is only respected on creation — chmod fixes existing installs
    // that were created without the mode parameter.
    try {
      chmodSync(DB_DIR, 0o700)
    } catch (err) {
      // Non-fatal: log but continue — app can still function
      log.warn(`[db] Failed to enforce .bde directory permissions: ${err}`)
    }
    const dbExists = existsSync(DB_PATH)
    _db = new Database(DB_PATH)

    // DL-23: Set explicit file permissions (0600 = owner read/write only)
    if (!dbExists) {
      try {
        chmodSync(DB_PATH, 0o600)
      } catch (err) {
        log.error(`[db] Failed to set database file permissions: ${err}`)
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
      log.error(`[db] WAL checkpoint failed during close: ${err}`)
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

  // Flush WAL to main DB before backup so the snapshot is consistent.
  // Without this, concurrent writes between the checkpoint and VACUUM INTO
  // can produce a backup that contains a partial WAL state.
  db.pragma('wal_checkpoint(TRUNCATE)')

  // DL-11: Propagate VACUUM INTO failures instead of swallowing
  const vacuumSql = `VACUUM INTO '${escapedPath}'`
  db.exec(vacuumSql)

  // DL-24: Verify backup integrity - check file exists and has reasonable size
  if (!existsSync(backupPath)) {
    throw new Error('Backup file was not created')
  }
  // The backup is a full snapshot of bde.db and contains the same secrets
  // (tokens, webhook HMAC keys, settings). Match the primary DB's 0600 mode
  // so endpoint-scanning and backup software cannot read it under umask 022.
  chmodSync(backupPath, 0o600)
  const backupSize = statSync(backupPath).size
  const originalSize = statSync(DB_PATH).size
  // Backup should be at least 50% of original size — a smaller result indicates
  // data loss, not just VACUUM compression (which is typically modest).
  if (backupSize < originalSize * 0.5) {
    log.error(
      `[db] Backup appears incomplete: ${backupSize} bytes vs original ${originalSize} bytes`
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
  const rawVersion = db.pragma('user_version', { simple: true })
  if (typeof rawVersion !== 'number') {
    throw new Error(
      `PRAGMA user_version returned non-number value: ${JSON.stringify(rawVersion)} (type: ${typeof rawVersion})`
    )
  }
  const currentVersion = rawVersion

  const pending = getPendingMigrations(migrations, currentVersion)

  if (pending.length === 0) return

  // DL-8 & DL-19: Run migrations individually with error context
  for (const migration of pending) {
    try {
      const runSingle = db.transaction(() => {
        migration.up(db)
        const sql = `PRAGMA user_version = ${Math.trunc(Number(migration.version))}`
        db.prepare(sql).run()
      })
      runSingle()
    } catch (err) {
      const msg = getErrorMessage(err)
      throw new Error(`Migration v${migration.version} ("${migration.description}") failed: ${msg}`)
    }
  }
}
