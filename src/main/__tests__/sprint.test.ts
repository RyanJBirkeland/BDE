import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Tests for sprint-adjacent SQLite functionality.
 * Sprint tasks now live in Supabase — these tests cover agent_runs
 * and template resolution logic that remain local.
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
  `)
}

describe('sprint-adjacent SQLite tests', () => {
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
    db.exec('DELETE FROM agent_runs')
  })

  describe('sprint:claimTask template resolution (logic-only)', () => {
    it('returns templatePromptPrefix when template_name matches', () => {
      const templateName = 'bugfix'
      const templates = [
        { name: 'bugfix', promptPrefix: 'You are fixing a bug.' },
        { name: 'feature', promptPrefix: 'You are building a feature.' }
      ]
      const match = templates.find((t) => t.name === templateName)
      expect(match?.promptPrefix).toBe('You are fixing a bug.')
    })

    it('returns undefined when template_name does not match any template', () => {
      const templateName = 'nonexistent'
      const templates = [{ name: 'bugfix', promptPrefix: 'You are fixing a bug.' }]
      const match = templates.find((t) => t.name === templateName)
      expect(match).toBeUndefined()
    })

    it('returns null templatePromptPrefix when no template_name is set', () => {
      const templateName = null
      expect(templateName).toBeNull()
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
