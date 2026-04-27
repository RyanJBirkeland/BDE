import type Database from 'better-sqlite3'

export const version = 15
export const description =
  'Recreate sprint_tasks table (migrating back from Supabase to local SQLite)'

export const up: (db: Database.Database) => void = (db) => {
  db.exec(`
        CREATE TABLE IF NOT EXISTS sprint_tasks (
          id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          title               TEXT NOT NULL,
          prompt              TEXT NOT NULL DEFAULT '',
          repo                TEXT NOT NULL DEFAULT 'fleet',
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
