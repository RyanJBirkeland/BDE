import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version, description } from '../v010-drop-fk-constraint-on-agent-run-id-agent-runs-live'

/**
 * v010 rebuilds `sprint_tasks` to drop the FK from `agent_run_id` → `agent_runs(id)`.
 * It does so via `INSERT INTO sprint_tasks_v10 SELECT * FROM sprint_tasks`, which is
 * positional — any drift between the prior schema column order and the v10 schema
 * would silently corrupt rows. These tests guard against that by seeding a v009-shaped
 * table with representative data and asserting every column survives the rebuild.
 */

type V9Row = {
  id: string
  title: string
  prompt: string
  repo: string
  status: string
  priority: number
  spec: string | null
  notes: string | null
  pr_url: string | null
  pr_number: number | null
  pr_status: string | null
  pr_mergeable_state: string | null
  agent_run_id: string | null
  retry_count: number
  fast_fail_count: number
  started_at: string | null
  completed_at: string | null
  claimed_by: string | null
  template_name: string | null
  created_at: string
  updated_at: string
}

function createV9Schema(db: Database.Database): void {
  // Matches v009's sprint_tasks definition exactly, including the FK that v010 drops.
  db.exec(`
    CREATE TABLE agent_runs (
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

    CREATE TABLE sprint_tasks (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title           TEXT NOT NULL,
      prompt          TEXT NOT NULL DEFAULT '',
      repo            TEXT NOT NULL DEFAULT 'fleet',
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
  `)
}

function insertV9Row(db: Database.Database, row: V9Row): void {
  db.prepare(
    `INSERT INTO sprint_tasks (
       id, title, prompt, repo, status, priority, spec, notes,
       pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
       retry_count, fast_fail_count,
       started_at, completed_at, claimed_by, template_name, created_at, updated_at
     ) VALUES (
       @id, @title, @prompt, @repo, @status, @priority, @spec, @notes,
       @pr_url, @pr_number, @pr_status, @pr_mergeable_state, @agent_run_id,
       @retry_count, @fast_fail_count,
       @started_at, @completed_at, @claimed_by, @template_name, @created_at, @updated_at
     )`
  ).run(row)
}

function selectRow(db: Database.Database, id: string): V9Row {
  return db.prepare('SELECT * FROM sprint_tasks WHERE id = ?').get(id) as V9Row
}

function foreignKeysOnColumn(db: Database.Database, table: string, column: string): number {
  const rows = db.pragma(`foreign_key_list(${table})`) as Array<{ from: string }>
  return rows.filter((fk) => fk.from === column).length
}

describe('migration v010', () => {
  it('has version 10 and a descriptive summary', () => {
    expect(version).toBe(10)
    expect(description.length).toBeGreaterThan(10)
    expect(description).toMatch(/FK|foreign key/i)
  })

  it('preserves every column value across the table rebuild', () => {
    const db = new Database(':memory:')
    createV9Schema(db)
    // FK on agent_run_id is live at v009 — seed a referenced run so the insert succeeds.
    db.prepare(`INSERT INTO agent_runs (id, started_at) VALUES (?, ?)`).run(
      'run-abc',
      '2026-01-01T00:00:00.000Z'
    )

    const seededRows: V9Row[] = [
      {
        id: 'task-one',
        title: 'Fully populated task',
        prompt: 'Implement feature X',
        repo: 'fleet',
        status: 'done',
        priority: 3,
        spec: '## Goal\nShip X',
        notes: 'Reviewed by human',
        pr_url: 'https://github.com/owner/repo/pull/42',
        pr_number: 42,
        pr_status: 'merged',
        pr_mergeable_state: 'clean',
        agent_run_id: 'run-abc',
        retry_count: 2,
        fast_fail_count: 1,
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T01:00:00.000Z',
        claimed_by: 'agent-1',
        template_name: 'feature',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T01:00:00.000Z'
      },
      {
        id: 'task-two',
        title: 'Task with nullable fields blank',
        prompt: '',
        repo: 'fleet',
        status: 'queued',
        priority: 1,
        spec: null,
        notes: null,
        pr_url: null,
        pr_number: null,
        pr_status: null,
        pr_mergeable_state: null,
        agent_run_id: null,
        retry_count: 0,
        fast_fail_count: 0,
        started_at: null,
        completed_at: null,
        claimed_by: null,
        template_name: null,
        created_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z'
      },
      {
        id: 'task-three',
        title: 'Error-status task mid-retry',
        prompt: 'Retry failing migration',
        repo: 'other-repo',
        status: 'error',
        priority: 2,
        spec: '## Reproduce\n1. Boot\n2. Observe crash',
        notes: 'Pinged owner',
        pr_url: null,
        pr_number: null,
        pr_status: null,
        pr_mergeable_state: null,
        agent_run_id: null,
        retry_count: 3,
        fast_fail_count: 3,
        started_at: '2026-01-03T00:00:00.000Z',
        completed_at: null,
        claimed_by: 'agent-2',
        template_name: 'bug-fix',
        created_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-03T00:10:00.000Z'
      }
    ]

    for (const row of seededRows) {
      insertV9Row(db, row)
    }

    up(db)

    for (const expected of seededRows) {
      const actual = selectRow(db, expected.id)
      expect(actual).toEqual(expected)
    }
    db.close()
  })

  it('drops the FK constraint on agent_run_id', () => {
    const db = new Database(':memory:')
    createV9Schema(db)

    expect(foreignKeysOnColumn(db, 'sprint_tasks', 'agent_run_id')).toBe(1)

    up(db)

    expect(foreignKeysOnColumn(db, 'sprint_tasks', 'agent_run_id')).toBe(0)

    // Post-migration the column accepts values that don't exist in agent_runs.
    db.prepare(
      `INSERT INTO sprint_tasks (id, title, agent_run_id) VALUES ('task-orphan', 'No run', 'does-not-exist')`
    ).run()
    const row = db
      .prepare('SELECT agent_run_id FROM sprint_tasks WHERE id = ?')
      .get('task-orphan') as { agent_run_id: string }
    expect(row.agent_run_id).toBe('does-not-exist')
    db.close()
  })

  it('recreates the status index and updated_at trigger on the rebuilt table', () => {
    const db = new Database(':memory:')
    createV9Schema(db)

    up(db)

    const index = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sprint_tasks_status'`
      )
      .get() as { name: string } | undefined
    expect(index?.name).toBe('idx_sprint_tasks_status')

    const trigger = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND name='sprint_tasks_updated_at'`
      )
      .get() as { name: string } | undefined
    expect(trigger?.name).toBe('sprint_tasks_updated_at')
    db.close()
  })
})
