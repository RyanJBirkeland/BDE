import type Database from 'better-sqlite3'

export const version = 20
export const description = 'Add review status to sprint_tasks CHECK constraint'

export const up: (db: Database.Database) => void = (db) => {
  // SQLite cannot ALTER CHECK constraints — recreate the table with updated CHECK.
  db.exec('PRAGMA foreign_keys = OFF;')
  try {
    db.exec(`
          CREATE TABLE sprint_tasks_v20 (
            id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            title               TEXT NOT NULL,
            prompt              TEXT NOT NULL DEFAULT '',
            repo                TEXT NOT NULL DEFAULT 'fleet',
            status              TEXT NOT NULL DEFAULT 'backlog'
                                  CHECK(status IN ('backlog','queued','active','review','done','cancelled','failed','error','blocked')),
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

          INSERT INTO sprint_tasks_v20 (
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
          ALTER TABLE sprint_tasks_v20 RENAME TO sprint_tasks;

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
