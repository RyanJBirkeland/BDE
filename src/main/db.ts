import Database from 'better-sqlite3'
import { mkdirSync, existsSync, chmodSync, statSync, unlinkSync } from 'fs'
import path from 'path'
import { BDE_DIR as DB_DIR, BDE_DB_PATH as DB_PATH } from './paths'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(DB_DIR, { recursive: true })
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

  // DL-11: Propagate VACUUM INTO failures instead of swallowing
  db.exec(`VACUUM INTO '${backupPath}'`)

  // DL-24: Verify backup integrity - check file exists and has reasonable size
  if (!existsSync(backupPath)) {
    throw new Error('Backup file was not created')
  }
  const backupSize = statSync(backupPath).size
  const originalSize = statSync(DB_PATH).size
  // Backup should be at least 10% of original size (VACUUM compresses)
  if (backupSize < originalSize * 0.1) {
    console.warn(`[db] Backup may be incomplete: ${backupSize} bytes (original: ${originalSize} bytes)`)
  }
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
      const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
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
      const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
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
      const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
      if (!cols.includes('claimed_by')) {
        db.exec('ALTER TABLE sprint_tasks ADD COLUMN claimed_by TEXT')
      }
    }
  },
  {
    version: 8,
    description: 'Add template_name column to sprint_tasks',
    up: (db) => {
      const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
      if (!cols.includes('template_name')) {
        db.exec('ALTER TABLE sprint_tasks ADD COLUMN template_name TEXT')
      }
    }
  },
  {
    version: 9,
    description:
      'Add error status, retry_count, fast_fail_count to sprint_tasks; add release endpoint support',
    up: (db) => {
      // SQLite cannot ALTER CHECK constraints — recreate the table with updated CHECK.
      db.exec('PRAGMA foreign_keys = OFF;')
      try {
        db.exec(`
          CREATE TABLE sprint_tasks_v9 (
            id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            title           TEXT NOT NULL,
            prompt          TEXT NOT NULL DEFAULT '',
            repo            TEXT NOT NULL DEFAULT 'bde',
            status          TEXT NOT NULL DEFAULT 'backlog'
                              CHECK(status IN ('backlog','queued','active','done','cancelled','failed','error')),
            priority        INTEGER NOT NULL DEFAULT 1,
            spec            TEXT,
            notes           TEXT,
            pr_url          TEXT,
            pr_number       INTEGER,
            pr_status       TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft')),
            pr_mergeable_state TEXT,
            agent_run_id    TEXT REFERENCES agent_runs(id),
            retry_count     INTEGER NOT NULL DEFAULT 0,
            fast_fail_count INTEGER NOT NULL DEFAULT 0,
            started_at      TEXT,
            completed_at    TEXT,
            claimed_by      TEXT,
            template_name   TEXT,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );

          INSERT INTO sprint_tasks_v9 (
            id, title, prompt, repo, status, priority, spec, notes,
            pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
            retry_count, fast_fail_count,
            started_at, completed_at, claimed_by, template_name, created_at, updated_at
          )
          SELECT
            id, title, prompt, repo, status, priority, spec, notes,
            pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
            0, 0,
            started_at, completed_at, claimed_by, template_name, created_at, updated_at
          FROM sprint_tasks;

          DROP TABLE sprint_tasks;
          ALTER TABLE sprint_tasks_v9 RENAME TO sprint_tasks;

          CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status ON sprint_tasks(status);

          CREATE TRIGGER IF NOT EXISTS sprint_tasks_updated_at
            AFTER UPDATE ON sprint_tasks
            BEGIN
              UPDATE sprint_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = NEW.id;
            END;
        `)
      } finally {
        db.exec('PRAGMA foreign_keys = ON;')
      }
    }
  },
  {
    version: 10,
    description:
      'Drop FK constraint on agent_run_id (agent runs live in task runner DB, not BDE DB)',
    up: (db) => {
      db.exec(`
        PRAGMA foreign_keys = OFF;

        CREATE TABLE sprint_tasks_v10 (
          id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          title           TEXT NOT NULL,
          prompt          TEXT NOT NULL DEFAULT '',
          repo            TEXT NOT NULL DEFAULT 'bde',
          status          TEXT NOT NULL DEFAULT 'backlog'
                            CHECK(status IN ('backlog','queued','active','done','cancelled','failed','error')),
          priority        INTEGER NOT NULL DEFAULT 1,
          spec            TEXT,
          notes           TEXT,
          pr_url          TEXT,
          pr_number       INTEGER,
          pr_status       TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft')),
          pr_mergeable_state TEXT,
          agent_run_id    TEXT,
          retry_count     INTEGER NOT NULL DEFAULT 0,
          fast_fail_count INTEGER NOT NULL DEFAULT 0,
          started_at      TEXT,
          completed_at    TEXT,
          claimed_by      TEXT,
          template_name   TEXT,
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        INSERT INTO sprint_tasks_v10 SELECT * FROM sprint_tasks;

        DROP TABLE sprint_tasks;
        ALTER TABLE sprint_tasks_v10 RENAME TO sprint_tasks;

        CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status ON sprint_tasks(status);

        CREATE TRIGGER IF NOT EXISTS sprint_tasks_updated_at
          AFTER UPDATE ON sprint_tasks
          BEGIN
            UPDATE sprint_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = NEW.id;
          END;

        PRAGMA foreign_keys = ON;
      `)
    }
  },
  {
    version: 11,
    description: 'Create agent_events table for unified event streaming',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_events (
          id INTEGER PRIMARY KEY,
          agent_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_events_agent
          ON agent_events(agent_id, timestamp);
      `)
    }
  },
  {
    version: 12,
    description: 'Drop sprint_tasks table — tasks now live in Supabase',
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS sprint_tasks;
        DROP TRIGGER IF EXISTS sprint_tasks_updated_at;
      `)
    }
  },
  {
    version: 13,
    description: 'Add sprint_task_id column to agent_runs for task-to-run linking',
    up: (db) => {
      const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
      if (!cols.includes('sprint_task_id')) {
        db.exec('ALTER TABLE agent_runs ADD COLUMN sprint_task_id TEXT')
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_agent_runs_sprint_task ON agent_runs(sprint_task_id)'
        )
      }
    }
  },
  {
    version: 14,
    description: 'Create task_changes table for audit trail',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          field TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          changed_by TEXT NOT NULL DEFAULT 'unknown',
          changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_task_changes_task_id ON task_changes(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_changes_changed_at ON task_changes(changed_at);
      `)
    }
  },
  {
    version: 15,
    description: 'Recreate sprint_tasks table (migrating back from Supabase to local SQLite)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sprint_tasks (
          id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          title               TEXT NOT NULL,
          prompt              TEXT NOT NULL DEFAULT '',
          repo                TEXT NOT NULL DEFAULT 'bde',
          status              TEXT NOT NULL DEFAULT 'backlog'
                                CHECK(status IN ('backlog','queued','blocked','active','done','cancelled','failed','error')),
          priority            INTEGER NOT NULL DEFAULT 1,
          spec                TEXT,
          notes               TEXT,
          pr_url              TEXT,
          pr_number           INTEGER,
          pr_status           TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft')),
          pr_mergeable_state  TEXT,
          agent_run_id        TEXT,
          retry_count         INTEGER NOT NULL DEFAULT 0,
          fast_fail_count     INTEGER NOT NULL DEFAULT 0,
          started_at          TEXT,
          completed_at        TEXT,
          claimed_by          TEXT,
          template_name       TEXT,
          depends_on          TEXT,
          playground_enabled  INTEGER NOT NULL DEFAULT 0,
          needs_review        INTEGER NOT NULL DEFAULT 0,
          max_runtime_ms      INTEGER,
          created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status     ON sprint_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_sprint_tasks_claimed_by ON sprint_tasks(claimed_by);
        CREATE INDEX IF NOT EXISTS idx_sprint_tasks_pr_number  ON sprint_tasks(pr_number);

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
    version: 16,
    description: 'Add spec_type column to sprint_tasks',
    up: (db) => {
      const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
      if (!cols.includes('spec_type')) {
        db.exec('ALTER TABLE sprint_tasks ADD COLUMN spec_type TEXT')
      }
    }
  },
  {
    version: 17,
    description: "Add 'branch_only' to pr_status CHECK constraint",
    up: (db) => {
      // SQLite cannot ALTER CHECK constraints — recreate the table with updated CHECK.
      db.exec('PRAGMA foreign_keys = OFF;')
      try {
        db.exec(`
          CREATE TABLE sprint_tasks_v17 (
            id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            title               TEXT NOT NULL,
            prompt              TEXT NOT NULL DEFAULT '',
            repo                TEXT NOT NULL DEFAULT 'bde',
            status              TEXT NOT NULL DEFAULT 'backlog'
                                  CHECK(status IN ('backlog','queued','active','done','cancelled','failed','error','blocked')),
            priority            INTEGER NOT NULL DEFAULT 1,
            depends_on          TEXT,
            spec                TEXT,
            notes               TEXT,
            pr_url              TEXT,
            pr_number           INTEGER,
            pr_status           TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft','branch_only')),
            pr_mergeable_state  TEXT,
            agent_run_id        TEXT,
            retry_count         INTEGER NOT NULL DEFAULT 0,
            fast_fail_count     INTEGER NOT NULL DEFAULT 0,
            started_at          TEXT,
            completed_at        TEXT,
            claimed_by          TEXT,
            template_name       TEXT,
            playground_enabled  INTEGER NOT NULL DEFAULT 0,
            needs_review        INTEGER NOT NULL DEFAULT 0,
            max_runtime_ms      INTEGER,
            spec_type           TEXT,
            created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );

          INSERT INTO sprint_tasks_v17 (
            id, title, prompt, repo, status, priority, depends_on, spec, notes,
            pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
            retry_count, fast_fail_count, started_at, completed_at, claimed_by,
            template_name, playground_enabled, needs_review, max_runtime_ms,
            spec_type, created_at, updated_at
          )
          SELECT
            id, title, prompt, repo, status, priority, depends_on, spec, notes,
            pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
            retry_count, fast_fail_count, started_at, completed_at, claimed_by,
            template_name, playground_enabled, needs_review, max_runtime_ms,
            spec_type, created_at, updated_at
          FROM sprint_tasks;

          DROP TABLE sprint_tasks;
          ALTER TABLE sprint_tasks_v17 RENAME TO sprint_tasks;

          CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status ON sprint_tasks(status);

          CREATE TRIGGER IF NOT EXISTS sprint_tasks_updated_at
            AFTER UPDATE ON sprint_tasks
            BEGIN
              UPDATE sprint_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = NEW.id;
            END;
        `)
      } finally {
        db.exec('PRAGMA foreign_keys = ON;')
      }
    }
  },
  {
    version: 18,
    description: 'Add agentManager.useNativeSystem setting',
    up: (db) => {
      // Add useNativeSystem setting (default false for gradual rollout)
      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value)
        VALUES ('agentManager.useNativeSystem', 'false')
      `).run()
    }
  },
  {
    version: 19,
    description: 'Remove agentManager.useNativeSystem setting (native system is now unconditional)',
    up: (db) => {
      db.prepare("DELETE FROM settings WHERE key = 'agentManager.useNativeSystem'").run()
    }
  }
]

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
        db.pragma(`user_version = ${migration.version}`)
      })
      runSingle()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Migration v${migration.version} ("${migration.description}") failed: ${msg}`
      )
    }
  }
}
