import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  up,
  version,
  description
} from '../v042-f-t3-db-6-f-t3-model-3-drop-unused-cost-events-tab'

function createCostEventsTable(db: Database.Database): void {
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

function createSettingsTable(db: Database.Database): void {
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
}

function insertCostEvent(
  db: Database.Database,
  id: string,
  source: string,
  model: string,
  totalTokens: number,
  costUsd: number
): void {
  db.prepare(
    'INSERT INTO cost_events (id, source, model, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)'
  ).run(id, source, model, totalTokens, costUsd)
}

function insertSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name: string } | undefined
  return row?.name === name
}

describe('migration v042', () => {
  it('has version 42 and a non-placeholder description', () => {
    expect(version).toBe(42)
    expect(description).not.toMatch(/^Add\s*$/)
    expect(description.length).toBeGreaterThan(10)
  })

  it('drops cost_events even when populated with rows and leaves other tables untouched', () => {
    const db = new Database(':memory:')
    createCostEventsTable(db)
    createSettingsTable(db)

    insertCostEvent(db, 'ce-1', 'pipeline', 'claude-opus-4', 1200, 0.042)
    insertCostEvent(db, 'ce-2', 'adhoc', 'claude-sonnet-4', 800, 0.018)
    insertCostEvent(db, 'ce-3', 'assistant', 'claude-haiku-4', 400, 0.004)

    insertSetting(db, 'theme', 'dark')
    insertSetting(db, 'agentManager.maxConcurrent', '2')

    expect(tableExists(db, 'cost_events')).toBe(true)
    expect(tableExists(db, 'settings')).toBe(true)

    up(db)

    expect(tableExists(db, 'cost_events')).toBe(false)

    expect(tableExists(db, 'settings')).toBe(true)
    const settingsRows = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as Array<{
      key: string
      value: string
    }>
    expect(settingsRows).toEqual([
      { key: 'agentManager.maxConcurrent', value: '2' },
      { key: 'theme', value: 'dark' }
    ])

    db.close()
  })

  it('is a no-op when cost_events does not exist (idempotent) and preserves other tables', () => {
    const db = new Database(':memory:')
    createSettingsTable(db)
    insertSetting(db, 'theme', 'dark')

    expect(tableExists(db, 'cost_events')).toBe(false)

    expect(() => up(db)).not.toThrow()

    expect(tableExists(db, 'cost_events')).toBe(false)
    expect(tableExists(db, 'settings')).toBe(true)
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as {
      value: string
    }
    expect(row.value).toBe('dark')

    db.close()
  })

  it('is idempotent (applying twice produces the same result)', () => {
    const db = new Database(':memory:')
    createCostEventsTable(db)
    insertCostEvent(db, 'ce-1', 'pipeline', 'claude-opus-4', 1200, 0.042)

    up(db)
    expect(() => up(db)).not.toThrow()

    expect(tableExists(db, 'cost_events')).toBe(false)
    db.close()
  })
})
