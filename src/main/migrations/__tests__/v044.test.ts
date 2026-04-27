/**
 * v044 creates the agent_run_turns table for per-turn token breakdown.
 */
import { describe, it, expect } from 'vitest'
import { up, version, description } from '../v044-add-agent-run-turns-table-for-per-turn-token-break'
import { makeMigrationTestDb, tableExists, listTableColumns, indexExists } from './helpers'

describe('migration v044', () => {
  it('has version 44 and a meaningful description', () => {
    expect(version).toBe(44)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates the agent_run_turns table', () => {
    const db = makeMigrationTestDb(43)
    expect(tableExists(db, 'agent_run_turns')).toBe(false)

    up(db)

    expect(tableExists(db, 'agent_run_turns')).toBe(true)
    db.close()
  })

  it('creates the expected columns', () => {
    const db = makeMigrationTestDb(43)
    up(db)

    const columns = listTableColumns(db, 'agent_run_turns')
    expect(columns).toContain('id')
    expect(columns).toContain('run_id')
    expect(columns).toContain('turn')
    expect(columns).toContain('tokens_in')
    expect(columns).toContain('tokens_out')
    expect(columns).toContain('tool_calls')
    expect(columns).toContain('recorded_at')
    db.close()
  })

  it('creates the idx_agent_run_turns_run index', () => {
    const db = makeMigrationTestDb(43)
    up(db)

    expect(indexExists(db, 'idx_agent_run_turns_run')).toBe(true)
    db.close()
  })

  it('inserts a turn row linked to an agent_run', () => {
    const db = makeMigrationTestDb(43)
    up(db)

    // Insert a referenced agent_run first
    db.prepare(
      `INSERT INTO agent_runs (id, bin, status, started_at)
       VALUES ('run-001', 'claude', 'running', '2026-01-01T00:00:00.000Z')`
    ).run()

    db.prepare(
      `INSERT INTO agent_run_turns (run_id, turn, tokens_in, tokens_out, tool_calls, recorded_at)
       VALUES ('run-001', 1, 500, 200, 3, '2026-01-01T00:01:00.000Z')`
    ).run()

    const row = db
      .prepare('SELECT * FROM agent_run_turns WHERE run_id = ?')
      .get('run-001') as { run_id: string; turn: number; tokens_in: number }
    expect(row.run_id).toBe('run-001')
    expect(row.turn).toBe(1)
    expect(row.tokens_in).toBe(500)
    db.close()
  })

  it('is idempotent (IF NOT EXISTS) — applying twice does not throw', () => {
    const db = makeMigrationTestDb(43)
    up(db)
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
