import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Tests for sprint SQLite handlers.
 * Uses a temp database with the same schema as db.ts.
 */

const TEST_DIR = join(tmpdir(), `bde-sprint-test-${process.pid}`)
const TEST_DB_PATH = join(TEST_DIR, 'bde.db')

let db: Database.Database

function initSchema(db: Database.Database): void {
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

    CREATE TRIGGER IF NOT EXISTS sprint_tasks_updated_at
      AFTER UPDATE ON sprint_tasks
      BEGIN
        UPDATE sprint_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = NEW.id;
      END;
  `)
}

describe('sprint SQLite handlers', () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    db = new Database(TEST_DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema(db)
  })

  afterAll(() => {
    db.close()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  beforeEach(() => {
    db.exec('DELETE FROM sprint_tasks')
    db.exec('DELETE FROM agent_runs')
  })

  describe('sprint:list', () => {
    it('returns empty array when no tasks exist', () => {
      const rows = db
        .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at DESC')
        .all()
      expect(rows).toEqual([])
    })

    it('returns tasks ordered by priority asc, created_at desc', () => {
      db.prepare(
        "INSERT INTO sprint_tasks (id, title, priority, created_at) VALUES ('a', 'Low', 10, '2026-01-01T00:00:00Z')"
      ).run()
      db.prepare(
        "INSERT INTO sprint_tasks (id, title, priority, created_at) VALUES ('b', 'High', 1, '2026-01-02T00:00:00Z')"
      ).run()
      db.prepare(
        "INSERT INTO sprint_tasks (id, title, priority, created_at) VALUES ('c', 'High older', 1, '2026-01-01T00:00:00Z')"
      ).run()

      const rows = db
        .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at DESC')
        .all() as { id: string }[]

      expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
    })
  })

  describe('sprint:create', () => {
    it('inserts a task with defaults', () => {
      const result = db
        .prepare(
          `INSERT INTO sprint_tasks (title, repo, prompt, priority, status)
           VALUES (@title, @repo, @prompt, @priority, @status)
           RETURNING *`
        )
        .get({
          title: 'Test task',
          repo: 'bde',
          prompt: 'Do something',
          priority: 0,
          status: 'backlog',
        }) as Record<string, unknown>

      expect(result.title).toBe('Test task')
      expect(result.repo).toBe('bde')
      expect(result.prompt).toBe('Do something')
      expect(result.status).toBe('backlog')
      expect(result.priority).toBe(0)
      expect(result.id).toBeTruthy()
      expect(result.created_at).toBeTruthy()
    })

    it('rejects invalid status values', () => {
      expect(() => {
        db.prepare(
          "INSERT INTO sprint_tasks (id, title, status) VALUES ('bad', 'Bad status', 'invalid')"
        ).run()
      }).toThrow()
    })
  })

  describe('sprint:update', () => {
    it('updates allowed fields and returns updated row', () => {
      db.prepare(
        "INSERT INTO sprint_tasks (id, title, status) VALUES ('u1', 'Original', 'backlog')"
      ).run()

      const allowed = ['title', 'status']
      const patch = { title: 'Updated', status: 'queued' }
      const entries = Object.entries(patch).filter(([k]) => allowed.includes(k))
      const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
      const values = entries.map(([, v]) => v)

      const result = db
        .prepare(`UPDATE sprint_tasks SET ${setClauses} WHERE id = ? RETURNING *`)
        .get(...values, 'u1') as Record<string, unknown>

      expect(result.title).toBe('Updated')
      expect(result.status).toBe('queued')
    })

    it('returns undefined for non-existent id', () => {
      const result = db
        .prepare('UPDATE sprint_tasks SET title = ? WHERE id = ? RETURNING *')
        .get('x', 'nonexistent')
      expect(result).toBeUndefined()
    })

    it('accepts agent_run_id in the update allowlist', () => {
      db.prepare(
        "INSERT INTO agent_runs (id, status, started_at) VALUES ('ar1', 'running', '2026-01-01T00:00:00Z')"
      ).run()
      db.prepare(
        "INSERT INTO sprint_tasks (id, title, status) VALUES ('u2', 'Link agent', 'active')"
      ).run()

      const allowed = [
        'title', 'prompt', 'repo', 'status', 'priority', 'spec', 'notes',
        'pr_url', 'pr_number', 'pr_status', 'agent_run_id', 'started_at', 'completed_at',
      ]
      const patch: Record<string, unknown> = { agent_run_id: 'ar1' }
      const entries = Object.entries(patch).filter(([k]) => allowed.includes(k))
      const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
      const values = entries.map(([, v]) => v)

      const result = db
        .prepare(`UPDATE sprint_tasks SET ${setClauses} WHERE id = ? RETURNING *`)
        .get(...values, 'u2') as Record<string, unknown>

      expect(result.agent_run_id).toBe('ar1')
    })

    it('rejects fields not in the update allowlist', () => {
      db.prepare(
        "INSERT INTO sprint_tasks (id, title, status) VALUES ('u3', 'No hack', 'backlog')"
      ).run()

      const allowed = [
        'title', 'prompt', 'repo', 'status', 'priority', 'spec', 'notes',
        'pr_url', 'pr_number', 'pr_status', 'agent_run_id', 'started_at', 'completed_at',
      ]
      const patch: Record<string, unknown> = { agent_session_id: 'bad', id: 'overwrite' }
      const entries = Object.entries(patch).filter(([k]) => allowed.includes(k))

      expect(entries).toEqual([])
    })
  })

  describe('sprint:delete', () => {
    it('deletes a task by id', () => {
      db.prepare(
        "INSERT INTO sprint_tasks (id, title) VALUES ('d1', 'To delete')"
      ).run()

      db.prepare('DELETE FROM sprint_tasks WHERE id = ?').run('d1')

      const row = db.prepare("SELECT * FROM sprint_tasks WHERE id = 'd1'").get()
      expect(row).toBeUndefined()
    })

    it('is a no-op for non-existent id', () => {
      const info = db.prepare('DELETE FROM sprint_tasks WHERE id = ?').run('ghost')
      expect(info.changes).toBe(0)
    })
  })

  describe('sprint:readLog', () => {
    it('reads log_path from agent_runs table', () => {
      const logPath = join(TEST_DIR, 'test.log')
      writeFileSync(logPath, 'hello log')

      db.prepare(
        "INSERT INTO agent_runs (id, status, log_path, started_at) VALUES ('r1', 'done', ?, '2026-01-01T00:00:00Z')"
      ).run(logPath)

      const agent = db
        .prepare('SELECT log_path, status FROM agent_runs WHERE id = ?')
        .get('r1') as { log_path: string; status: string }

      expect(agent.log_path).toBe(logPath)
      expect(agent.status).toBe('done')
    })

    it('returns undefined for non-existent agent', () => {
      const agent = db
        .prepare('SELECT log_path, status FROM agent_runs WHERE id = ?')
        .get('missing')
      expect(agent).toBeUndefined()
    })
  })
})
