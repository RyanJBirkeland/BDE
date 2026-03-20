import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { BDE_DIR as DB_DIR, BDE_DB_PATH as DB_PATH } from './paths'

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

export interface Migration {
  version: number
  description: string
  up: (db: Database.Database) => void
}

// To add a new migration:
// 1. Add a new entry to the migrations array with version = last + 1
// 2. Write the `up` function with the schema change
// 3. Never modify or reorder existing migrations
export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Create core tables (agent_runs, settings)',
    up: (db) => {
      // NOTE: sprint_tasks created in migration v6 (local ownership).
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

        CREATE TABLE IF NOT EXISTS settings (
          key          TEXT PRIMARY KEY,
          value        TEXT NOT NULL,
          updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE INDEX IF NOT EXISTS idx_agent_runs_pid      ON agent_runs(pid);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status   ON agent_runs(status);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_finished ON agent_runs(finished_at, started_at DESC);
      `)
    }
  },
  {
    version: 2,
    description: 'NOOP — version number preserved for compatibility',
    up: (_db) => {
      // Version number preserved so existing DBs (user_version=2+) are not affected.
    }
  },
  {
    version: 3,
    description: 'Add cost columns to agent_runs',
    up: (db) => {
      const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map(
        (c) => c.name
      )
      for (const [col, type] of [
        ['cost_usd', 'REAL'],
        ['tokens_in', 'INTEGER'],
        ['tokens_out', 'INTEGER'],
        ['cache_read', 'INTEGER'],
        ['cache_create', 'INTEGER'],
        ['duration_ms', 'INTEGER'],
        ['num_turns', 'INTEGER']
      ] as const) {
        if (!cols.includes(col)) {
          db.exec(`ALTER TABLE agent_runs ADD COLUMN ${col} ${type}`)
        }
      }
    }
  },
  {
    version: 4,
    description: 'Create cost_events table',
    up: (db) => {
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
  },
  {
    version: 5,
    description: 'Add source column to agent_runs',
    up: (db) => {
      const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map(c => c.name)
      if (!cols.includes('source')) {
        db.exec("ALTER TABLE agent_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'bde'")
      }
    }
  },
  {
    version: 6,
    description: 'Create sprint_tasks table (local ownership)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sprint_tasks (
          id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          title           TEXT NOT NULL,
          prompt          TEXT NOT NULL DEFAULT '',
          repo            TEXT NOT NULL DEFAULT 'bde',
          status          TEXT NOT NULL DEFAULT 'backlog'
                            CHECK(status IN ('backlog','queued','active','done','cancelled','failed')),
          priority        INTEGER NOT NULL DEFAULT 1,
          spec            TEXT,
          notes           TEXT,
          pr_url          TEXT,
          pr_number       INTEGER,
          pr_status       TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft')),
          pr_mergeable_state TEXT,
          agent_run_id    TEXT REFERENCES agent_runs(id),
          started_at      TEXT,
          completed_at    TEXT,
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status ON sprint_tasks(status);

        CREATE TRIGGER IF NOT EXISTS sprint_tasks_updated_at
          AFTER UPDATE ON sprint_tasks
          BEGIN
            UPDATE sprint_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = NEW.id;
          END;
      `)
    }
  },
  {
    version: 7,
    description: 'Add claimed_by column to sprint_tasks',
    up: (db) => {
      const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map(c => c.name)
      if (!cols.includes('claimed_by')) {
        db.exec('ALTER TABLE sprint_tasks ADD COLUMN claimed_by TEXT')
      }
    }
  },
  {
    version: 8,
    description: 'Add template_name column to sprint_tasks',
    up: (db) => {
      const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map(c => c.name)
      if (!cols.includes('template_name')) {
        db.exec('ALTER TABLE sprint_tasks ADD COLUMN template_name TEXT')
      }
    }
  }
]

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)

  if (pending.length === 0) return

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    }
  })
  runAll()
}
