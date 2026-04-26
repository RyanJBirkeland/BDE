import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version, description } from '../v001-create-core-tables-agent-runs-settings'
import { tableExists, indexExists } from './helpers'

describe('migration v001', () => {
  it('has version 1 and a meaningful description', () => {
    expect(version).toBe(1)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates agent_runs and settings tables on a fresh database', () => {
    const db = new Database(':memory:')
    up(db)

    expect(tableExists(db, 'agent_runs')).toBe(true)
    expect(tableExists(db, 'settings')).toBe(true)
    db.close()
  })

  it('creates expected indexes on agent_runs', () => {
    const db = new Database(':memory:')
    up(db)

    expect(indexExists(db, 'idx_agent_runs_pid')).toBe(true)
    expect(indexExists(db, 'idx_agent_runs_status')).toBe(true)
    expect(indexExists(db, 'idx_agent_runs_finished')).toBe(true)
    db.close()
  })

  it('enforces the agent_runs status CHECK constraint', () => {
    const db = new Database(':memory:')
    up(db)

    expect(() => {
      db.prepare(
        `INSERT INTO agent_runs (id, status, started_at) VALUES ('a1', 'not-valid', '2025-01-01')`
      ).run()
    }).toThrow()
    db.close()
  })

  it('accepts allowed status values on agent_runs', () => {
    const db = new Database(':memory:')
    up(db)

    for (const status of ['running', 'done', 'failed', 'unknown']) {
      expect(() => {
        db.prepare(
          `INSERT INTO agent_runs (id, status, started_at) VALUES (?, ?, '2025-01-01')`
        ).run(`run-${status}`, status)
      }).not.toThrow()
    }
    db.close()
  })

  it('is idempotent when applied twice on a fresh database', () => {
    const db = new Database(':memory:')
    up(db)
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
