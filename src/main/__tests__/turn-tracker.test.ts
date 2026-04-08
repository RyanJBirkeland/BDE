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
  const schema = `
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'running');
    CREATE TABLE agent_run_turns (
      id          INTEGER PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      turn        INTEGER NOT NULL,
      tokens_in   INTEGER,
      tokens_out  INTEGER,
      tool_calls  INTEGER,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX idx_agent_run_turns_run ON agent_run_turns(run_id);
  `
  db.exec(schema)
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
    expect(tracker.totals()).toEqual({ tokensIn: 0, tokensOut: 0 })
  })

  it('accumulates tokens from usage object on assistant messages', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'assistant', usage: { input_tokens: 100, output_tokens: 50 } })
    tracker.observe({ type: 'assistant', usage: { input_tokens: 200, output_tokens: 80 } })
    expect(tracker.totals()).toEqual({ tokensIn: 300, tokensOut: 130 })
  })

  it('accumulates tokens from top-level fields on result/system messages', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'result', tokens_in: 500, tokens_out: 200 })
    expect(tracker.totals()).toEqual({ tokensIn: 500, tokensOut: 200 })
  })

  it('accumulates from both sources when both present on same message', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 100, output_tokens: 50 },
      tokens_in: 10,
      tokens_out: 5
    })
    expect(tracker.totals()).toEqual({ tokensIn: 110, tokensOut: 55 })
  })

  it('writes one turn row per assistant message with cumulative totals', () => {
    const tracker = new TurnTracker('run-1', db)

    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 100, output_tokens: 50 },
      message: { content: [{ type: 'tool_use', name: 'Read' }] }
    })
    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 200, output_tokens: 80 }
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
      usage: { input_tokens: 100, output_tokens: 50 },
      message: {
        content: [
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Write' }
        ]
      }
    })
    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 50, output_tokens: 20 }
    })

    const rows = db
      .prepare('SELECT tool_calls, tokens_in FROM agent_run_turns ORDER BY turn')
      .all() as Array<{ tool_calls: number; tokens_in: number }>

    expect(rows[0].tool_calls).toBe(2)
    expect(rows[1].tool_calls).toBe(0)
    expect(rows[1].tokens_in).toBe(150)
  })

  it('returns accumulated totals and writes no rows for a zero-turn run', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'system', subtype: 'init' })
    tracker.observe({ type: 'result', tokens_in: 50, tokens_out: 10 })

    expect(tracker.totals()).toEqual({ tokensIn: 50, tokensOut: 10 })
    const count = (
      db.prepare('SELECT COUNT(*) as c FROM agent_run_turns').get() as { c: number }
    ).c
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
    expect(tracker.totals()).toEqual({ tokensIn: 0, tokensOut: 0 })
  })
})
