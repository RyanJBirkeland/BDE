import type Database from 'better-sqlite3'

export const version = 60
export const description =
  "Add 'approved' to sprint_tasks status CHECK constraint for PR group approval workflow"

export const up = (db: Database.Database): void => {
  // SQLite cannot ALTER a CHECK constraint — the table must be recreated.
  // This migration adds 'approved' to the status allowlist so that tasks
  // in a PR group can be marked approved (human-blessed, waiting to ship)
  // without violating the DB constraint.
  db.exec('PRAGMA foreign_keys = OFF;')
  try {
    db.exec(`
      CREATE TABLE sprint_tasks_v60 (
        id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        title                 TEXT NOT NULL,
        prompt                TEXT NOT NULL DEFAULT '',
        repo                  TEXT NOT NULL DEFAULT 'fleet',
        status                TEXT NOT NULL DEFAULT 'backlog'
                                CHECK(status IN ('backlog','queued','active','review','approved','done','cancelled','failed','error','blocked')),
        priority              INTEGER NOT NULL DEFAULT 1,
        depends_on            TEXT,
        spec                  TEXT,
        notes                 TEXT,
        pr_url                TEXT,
        pr_number             INTEGER,
        pr_status             TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft','branch_only')),
        pr_mergeable_state    TEXT,
        agent_run_id          TEXT,
        retry_count           INTEGER NOT NULL DEFAULT 0,
        fast_fail_count       INTEGER NOT NULL DEFAULT 0,
        started_at            TEXT,
        completed_at          TEXT,
        claimed_by            TEXT,
        template_name         TEXT,
        playground_enabled    INTEGER NOT NULL DEFAULT 0,
        needs_review          INTEGER NOT NULL DEFAULT 0,
        max_runtime_ms        INTEGER,
        spec_type             TEXT,
        created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        worktree_path         TEXT,
        session_id            TEXT,
        next_eligible_at      TEXT,
        model                 TEXT,
        retry_context         TEXT,
        failure_reason        TEXT,
        max_cost_usd          REAL,
        partial_diff          TEXT,
        assigned_reviewer     TEXT,
        tags                  TEXT,
        sprint_id             TEXT,
        group_id              TEXT REFERENCES task_groups(id),
        duration_ms           INTEGER,
        revision_feedback     TEXT,
        review_diff_snapshot  TEXT,
        promoted_to_review_at TEXT,
        rebase_base_sha       TEXT,
        rebased_at            TEXT,
        orphan_recovery_count INTEGER NOT NULL DEFAULT 0,
        last_rendered_prompt  TEXT,
        stacked_on_task_id    TEXT
      );

      INSERT INTO sprint_tasks_v60 (
        id, title, prompt, repo, status, priority, depends_on, spec, notes,
        pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
        retry_count, fast_fail_count, started_at, completed_at, claimed_by,
        template_name, playground_enabled, needs_review, max_runtime_ms,
        spec_type, created_at, updated_at, worktree_path, session_id,
        next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
        partial_diff, assigned_reviewer, tags, sprint_id, group_id, duration_ms,
        revision_feedback, review_diff_snapshot, promoted_to_review_at,
        rebase_base_sha, rebased_at, orphan_recovery_count, last_rendered_prompt,
        stacked_on_task_id
      )
      SELECT
        id, title, prompt, repo, status, priority, depends_on, spec, notes,
        pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
        retry_count, fast_fail_count, started_at, completed_at, claimed_by,
        template_name, playground_enabled, needs_review, max_runtime_ms,
        spec_type, created_at, updated_at, worktree_path, session_id,
        next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
        partial_diff, assigned_reviewer, tags, sprint_id, group_id, duration_ms,
        revision_feedback, review_diff_snapshot, promoted_to_review_at,
        rebase_base_sha, rebased_at, orphan_recovery_count, last_rendered_prompt,
        stacked_on_task_id
      FROM sprint_tasks;

      DROP TABLE sprint_tasks;
      ALTER TABLE sprint_tasks_v60 RENAME TO sprint_tasks;

      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status ON sprint_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_claimed_by ON sprint_tasks(claimed_by);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_pr_number ON sprint_tasks(pr_number);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_group ON sprint_tasks(group_id);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_group_id ON sprint_tasks(group_id);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_sprint ON sprint_tasks(sprint_id);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status_claimed ON sprint_tasks(status, claimed_by);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_pr_open ON sprint_tasks(pr_status, pr_number) WHERE pr_status = 'open';
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_pr_number_status ON sprint_tasks(pr_number, status);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_completed_at ON sprint_tasks(completed_at ASC);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_started_at ON sprint_tasks(started_at ASC);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status_completed_at ON sprint_tasks(status, completed_at);
      CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status_started_at ON sprint_tasks(status, started_at);

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
