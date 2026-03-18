import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'

const DB_DIR = join(homedir(), '.bde')
const DB_PATH = join(DB_DIR, 'bde.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(DB_DIR, { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
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
  _db?.close()
  _db = null
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id           TEXT PRIMARY KEY,
      pid          INTEGER,
      bin          TEXT NOT NULL DEFAULT 'claude',
      task         TEXT,
      repo         TEXT,
      repo_path    TEXT,
      model        TEXT,
      status       TEXT NOT NULL DEFAULT 'running'
                     CHECK(status IN ('running','done','failed','unknown')),
      log_path     TEXT,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      exit_code    INTEGER
    );

    CREATE TABLE IF NOT EXISTS sprint_tasks (
      id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title        TEXT NOT NULL,
      prompt       TEXT NOT NULL DEFAULT '',
      repo         TEXT NOT NULL DEFAULT 'bde',
      status       TEXT NOT NULL DEFAULT 'backlog'
                     CHECK(status IN ('backlog','queued','active','done','cancelled')),
      priority     INTEGER NOT NULL DEFAULT 1,
      spec         TEXT,
      notes        TEXT,
      pr_url       TEXT,
      pr_number    INTEGER,
      pr_status    TEXT,
      agent_run_id TEXT REFERENCES agent_runs(id),
      started_at   TEXT,
      completed_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key          TEXT PRIMARY KEY,
      value        TEXT NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TRIGGER IF NOT EXISTS sprint_tasks_updated_at
      AFTER UPDATE ON sprint_tasks
      BEGIN
        UPDATE sprint_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = NEW.id;
      END;

    CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status ON sprint_tasks(status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_pid      ON agent_runs(pid);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status   ON agent_runs(status);
  `)

  // Add pr_mergeable_state column (idempotent)
  try {
    db.exec('ALTER TABLE sprint_tasks ADD COLUMN pr_mergeable_state TEXT')
  } catch {
    // Column already exists — ignore
  }

  // Add cost columns to agent_runs (PRAGMA-guarded, idempotent)
  const agentRunCols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map(
    (c) => c.name
  )
  const costColumns: [string, string][] = [
    ['cost_usd', 'REAL'],
    ['tokens_in', 'INTEGER'],
    ['tokens_out', 'INTEGER'],
    ['cache_read', 'INTEGER'],
    ['cache_create', 'INTEGER'],
    ['duration_ms', 'INTEGER'],
    ['num_turns', 'INTEGER']
  ]
  for (const [col, type] of costColumns) {
    if (!agentRunCols.includes(col)) {
      db.exec(`ALTER TABLE agent_runs ADD COLUMN ${col} ${type}`)
    }
  }

  // Create cost_events table for OpenClaw token snapshots (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_events (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      source        TEXT NOT NULL,
      session_key   TEXT,
      model         TEXT NOT NULL,
      total_tokens  INTEGER NOT NULL DEFAULT 0,
      cost_usd      REAL,
      recorded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
}
