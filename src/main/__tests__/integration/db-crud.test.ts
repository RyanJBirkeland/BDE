import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { migrations, runMigrations } from '../../db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
})

afterEach(() => {
  db.close()
})

describe('migrations', () => {
  it('runs all migrations on in-memory DB without errors', () => {
    expect(() => runMigrations(db)).not.toThrow()

    const version = db.pragma('user_version', { simple: true }) as number
    const maxVersion = Math.max(...migrations.map((m) => m.version))
    expect(version).toBe(maxVersion)
  })

  it('is idempotent — running twice does not error', () => {
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })
})

describe('settings CRUD', () => {
  beforeEach(() => {
    runMigrations(db)
  })

  it('set -> get -> delete -> get returns null', () => {
    // Insert
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).run('theme', 'dark')

    // Read
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as
      | { value: string }
      | undefined
    expect(row?.value).toBe('dark')

    // Update
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).run('theme', 'light')
    const updated = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as
      | { value: string }
      | undefined
    expect(updated?.value).toBe('light')

    // Delete
    db.prepare('DELETE FROM settings WHERE key = ?').run('theme')
    const deleted = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme')
    expect(deleted).toBeUndefined()
  })
})

describe('agent_runs CRUD', () => {
  beforeEach(() => {
    runMigrations(db)
  })

  it('insert -> select -> update status -> select confirms update', () => {
    const id = 'run-001'
    const now = new Date().toISOString()

    // Insert
    db.prepare(
      'INSERT INTO agent_runs (id, bin, task, repo, status, started_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, 'claude', 'fix bug', 'bde', 'running', now)

    // Select
    const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    expect(row.id).toBe(id)
    expect(row.status).toBe('running')
    expect(row.task).toBe('fix bug')

    // Update status
    db.prepare('UPDATE agent_runs SET status = ?, finished_at = ? WHERE id = ?').run(
      'done',
      now,
      id
    )

    // Confirm update
    const updated = db
      .prepare('SELECT status, finished_at FROM agent_runs WHERE id = ?')
      .get(id) as Record<string, unknown>
    expect(updated.status).toBe('done')
    expect(updated.finished_at).toBe(now)
  })

  it('rejects invalid status values', () => {
    expect(() =>
      db
        .prepare('INSERT INTO agent_runs (id, bin, status, started_at) VALUES (?, ?, ?, ?)')
        .run('run-bad', 'claude', 'invalid_status', new Date().toISOString())
    ).toThrow()
  })
})

describe('agent_events CRUD', () => {
  beforeEach(() => {
    runMigrations(db)
  })

  it('insert -> query by agent_id -> verify ordering by timestamp', () => {
    const agentId = 'agent-abc'

    // Insert events out of order
    db.prepare(
      'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
    ).run(agentId, 'tool_use', '{"tool":"bash"}', 300)

    db.prepare(
      'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
    ).run(agentId, 'message', '{"text":"hello"}', 100)

    db.prepare(
      'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
    ).run(agentId, 'cost', '{"usd":0.01}', 200)

    // Insert event for different agent — should not appear in query
    db.prepare(
      'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
    ).run('other-agent', 'message', '{"text":"noise"}', 150)

    // Query by agent_id ordered by timestamp
    const rows = db
      .prepare('SELECT * FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC')
      .all(agentId) as { event_type: string; timestamp: number }[]

    expect(rows).toHaveLength(3)
    expect(rows[0].event_type).toBe('message')
    expect(rows[0].timestamp).toBe(100)
    expect(rows[1].event_type).toBe('cost')
    expect(rows[1].timestamp).toBe(200)
    expect(rows[2].event_type).toBe('tool_use')
    expect(rows[2].timestamp).toBe(300)
  })
})

describe('cost_events CRUD', () => {
  beforeEach(() => {
    runMigrations(db)
  })

  it('insert -> verify columns populated', () => {
    db.prepare(
      'INSERT INTO cost_events (id, source, session_key, model, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('ce-001', 'bde-agent', 'sess-123', 'claude-sonnet-4-20250514', 5000, 0.015)

    const row = db.prepare('SELECT * FROM cost_events WHERE id = ?').get('ce-001') as Record<
      string,
      unknown
    >

    expect(row.id).toBe('ce-001')
    expect(row.source).toBe('bde-agent')
    expect(row.session_key).toBe('sess-123')
    expect(row.model).toBe('claude-sonnet-4-20250514')
    expect(row.total_tokens).toBe(5000)
    expect(row.cost_usd).toBe(0.015)
    expect(row.recorded_at).toBeDefined()
  })

  it('auto-generates id when not provided', () => {
    db.prepare('INSERT INTO cost_events (source, model, total_tokens) VALUES (?, ?, ?)').run(
      'manual',
      'gpt-4',
      1000
    )

    const row = db.prepare('SELECT id FROM cost_events WHERE source = ?').get('manual') as {
      id: string
    }
    expect(row.id).toBeTruthy()
    expect(row.id.length).toBe(32) // hex(randomblob(16)) = 32 chars
  })
})
