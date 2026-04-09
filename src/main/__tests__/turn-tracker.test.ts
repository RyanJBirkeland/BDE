import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getName: vi.fn(() => 'BDE'),
    getVersion: vi.fn(() => '0.0.0')
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

import { TurnTracker } from '../agent-manager/turn-tracker'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(
    "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'running')"
  ).run()
  db.prepare(
    `CREATE TABLE agent_run_turns (
      id                   INTEGER PRIMARY KEY,
      run_id               TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      turn                 INTEGER NOT NULL,
      tokens_in            INTEGER,
      tokens_out           INTEGER,
      tool_calls           INTEGER,
      cache_tokens_created INTEGER,
      cache_tokens_read    INTEGER,
      recorded_at          TEXT NOT NULL
    )`
  ).run()
  db.prepare('CREATE INDEX idx_agent_run_turns_run ON agent_run_turns(run_id)').run()
  return db
}

describe('TurnTracker', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
    db.prepare("INSERT INTO agent_runs (id) VALUES ('run-1')").run()
  })

  it('starts with zero totals', () => {
    const tracker = new TurnTracker('run-1', db)
    expect(tracker.totals()).toMatchObject({ tokensIn: 0, tokensOut: 0 })
  })

  it('accumulates tokens from msg.message.usage (real SDK format)', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
    })
    tracker.observe({
      type: 'assistant',
      message: { usage: { input_tokens: 200, output_tokens: 80 }, content: [] }
    })
    expect(tracker.totals()).toMatchObject({ tokensIn: 300, tokensOut: 130 })
  })

  it('falls back to msg.usage when msg.message.usage absent', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'assistant', usage: { input_tokens: 100, output_tokens: 50 } })
    tracker.observe({ type: 'assistant', usage: { input_tokens: 200, output_tokens: 80 } })
    expect(tracker.totals()).toMatchObject({ tokensIn: 300, tokensOut: 130 })
  })

  it('accumulates cache tokens from msg.message.usage', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 80000,
          cache_read_input_tokens: 0
        },
        content: []
      }
    })
    tracker.observe({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 8,
          output_tokens: 4,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 80000
        },
        content: []
      }
    })

    const rows = db
      .prepare('SELECT cache_tokens_created, cache_tokens_read FROM agent_run_turns ORDER BY turn')
      .all() as Array<{ cache_tokens_created: number; cache_tokens_read: number }>

    // Turn 1: 80k cache_creation, 0 cache_read (cumulative)
    expect(rows[0]).toMatchObject({ cache_tokens_created: 80000, cache_tokens_read: 0 })
    // Turn 2: cumulative 80k cache_creation + 0, cumulative 0 + 80k cache_read
    expect(rows[1]).toMatchObject({ cache_tokens_created: 80000, cache_tokens_read: 80000 })
  })

  it('stores zero cache tokens when cache fields absent from usage', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
    })

    const row = db
      .prepare('SELECT cache_tokens_created, cache_tokens_read FROM agent_run_turns')
      .get() as { cache_tokens_created: number | null; cache_tokens_read: number | null }

    expect(row.cache_tokens_created).toBe(0)
    expect(row.cache_tokens_read).toBe(0)
  })

  it('ignores non-assistant messages (result/system carry no useful token data)', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'result', tokens_in: 500, tokens_out: 200 })
    tracker.observe({ type: 'system', subtype: 'init' })
    expect(tracker.totals()).toMatchObject({ tokensIn: 0, tokensOut: 0 })
  })

  it('ignores top-level tokens_in/tokens_out even on assistant messages', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] },
      tokens_in: 10,
      tokens_out: 5
    })
    // Only message.usage counts — top-level tokens_in/out are ignored
    expect(tracker.totals()).toMatchObject({ tokensIn: 100, tokensOut: 50 })
  })

  it('writes one turn row per assistant message with cumulative totals', () => {
    const tracker = new TurnTracker('run-1', db)

    tracker.observe({
      type: 'assistant',
      message: {
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: 'tool_use', name: 'Read' }]
      }
    })
    tracker.observe({
      type: 'assistant',
      message: { usage: { input_tokens: 200, output_tokens: 80 }, content: [] }
    })

    const rows = db
      .prepare('SELECT turn, tokens_in, tokens_out, tool_calls FROM agent_run_turns ORDER BY turn')
      .all() as Array<{ turn: number; tokens_in: number; tokens_out: number; tool_calls: number }>

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ turn: 1, tokens_in: 100, tokens_out: 50, tool_calls: 1 })
    expect(rows[1]).toMatchObject({ turn: 2, tokens_in: 300, tokens_out: 130, tool_calls: 0 })
  })

  it('resets tool_calls per turn but keeps cumulative tokens', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      message: {
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Write' }
        ]
      }
    })
    tracker.observe({
      type: 'assistant',
      message: { usage: { input_tokens: 50, output_tokens: 20 }, content: [] }
    })

    const rows = db
      .prepare('SELECT tool_calls, tokens_in FROM agent_run_turns ORDER BY turn')
      .all() as Array<{ tool_calls: number; tokens_in: number }>

    expect(rows[0].tool_calls).toBe(2)
    expect(rows[1].tool_calls).toBe(0)
    expect(rows[1].tokens_in).toBe(150)
  })

  it('returns zero totals and writes no rows for a zero-turn run', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'system', subtype: 'init' })
    tracker.observe({ type: 'result', tokens_in: 50, tokens_out: 10 })

    expect(tracker.totals()).toMatchObject({ tokensIn: 0, tokensOut: 0 })
    const count = (db.prepare('SELECT COUNT(*) as c FROM agent_run_turns').get() as { c: number }).c
    expect(count).toBe(0)
  })

  it('ignores non-object and null messages without throwing', () => {
    const tracker = new TurnTracker('run-1', db)
    expect(() => {
      tracker.observe(null)
      tracker.observe(undefined)
      tracker.observe('string message')
      tracker.observe(42)
    }).not.toThrow()
    expect(tracker.totals()).toMatchObject({ tokensIn: 0, tokensOut: 0 })
  })
})
