import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `bde-db-test-${process.pid}`)
const TEST_DB_PATH = join(TEST_DIR, 'bde.db')

/**
 * Smoke test: runs the same migration SQL that db.ts uses against an
 * in-memory-style temp database and verifies all expected tables,
 * indexes, and triggers exist.
 */
describe('db schema migrations', () => {
  let db: Database.Database

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    db = new Database(TEST_DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Run the same migration SQL from db.ts
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
  })

  afterAll(() => {
    db.close()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('creates sprint_tasks table', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sprint_tasks'")
      .get() as { name: string } | undefined
    expect(row?.name).toBe('sprint_tasks')
  })

  it('creates agent_runs table', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runs'")
      .get() as { name: string } | undefined
    expect(row?.name).toBe('agent_runs')
  })

  it('creates settings table', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
      .get() as { name: string } | undefined
    expect(row?.name).toBe('settings')
  })

  it('creates sprint_tasks_updated_at trigger', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='sprint_tasks_updated_at'")
      .get() as { name: string } | undefined
    expect(row?.name).toBe('sprint_tasks_updated_at')
  })

  it('creates expected indexes', () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    const names = indexes.map((i) => i.name).sort()
    expect(names).toEqual([
      'idx_agent_runs_pid',
      'idx_agent_runs_status',
      'idx_sprint_tasks_status'
    ])
  })

  it('enforces sprint_tasks status CHECK constraint', () => {
    expect(() => {
      db.prepare(
        "INSERT INTO sprint_tasks (id, title, status) VALUES ('test1', 'bad status', 'invalid')"
      ).run()
    }).toThrow()
  })

  it('sets WAL journal mode', () => {
    const result = db.pragma('journal_mode') as { journal_mode: string }[]
    expect(result[0].journal_mode).toBe('wal')
  })
})
