/**
 * Shared test helpers for per-migration tests.
 *
 * Each migration test creates a fresh in-memory SQLite DB, runs all migrations
 * up to version N-1, then applies migration N in isolation to verify correctness.
 */
import Database from 'better-sqlite3'
import { loadMigrations } from '../loader'

/**
 * Creates an in-memory SQLite DB with all migrations applied up to and
 * including `upToVersion`. Suitable for seeding data before testing the
 * next migration.
 */
export function makeMigrationTestDb(upToVersion: number): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const migrations = loadMigrations().filter((m) => m.version <= upToVersion)
  for (const migration of migrations) {
    migration.up(db)
  }

  return db
}

/**
 * Returns the column names for the given table.
 */
export function listTableColumns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
}

/**
 * Returns true when the named index exists in the database.
 */
export function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(indexName) as { name: string } | undefined
  return row !== undefined
}

/**
 * Returns true when the named table exists in the database.
 */
export function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined
  return row !== undefined
}
