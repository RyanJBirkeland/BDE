import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import { getCostSummary, getRecentAgentRunsWithCost } from '../cost-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('getCostSummary', () => {
  it('returns zero values for empty DB', () => {
    const summary = getCostSummary(db)
    expect(summary.tasksToday).toBe(0)
    expect(summary.tasksThisWeek).toBe(0)
    expect(summary.tasksAllTime).toBe(0)
    expect(summary.totalTokensThisWeek).toBe(0)
    expect(summary.avgTokensPerTask).toBeNull()
    expect(summary.mostTokenIntensiveTask).toBeNull()
  })

  it('counts done tasks in summary', () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO agent_runs (id, bin, status, started_at, cost_usd, tokens_in, tokens_out)
       VALUES (?, 'claude', 'done', ?, 0.10, 500, 200)`
    ).run('run-1', now)
    db.prepare(
      `INSERT INTO agent_runs (id, bin, status, started_at, cost_usd, tokens_in, tokens_out)
       VALUES (?, 'claude', 'done', ?, 0.20, 300, 100)`
    ).run('run-2', now)

    const summary = getCostSummary(db)
    expect(summary.tasksToday).toBe(2)
    expect(summary.tasksThisWeek).toBe(2)
    expect(summary.tasksAllTime).toBe(2)
    expect(summary.totalTokensThisWeek).toBe(1100) // 500+200+300+100
    expect(summary.avgTokensPerTask).toBeCloseTo(550) // (700+400)/2
    expect(summary.mostTokenIntensiveTask).not.toBeNull()
    expect(summary.mostTokenIntensiveTask!.totalTokens).toBe(700) // 500+200
  })
})

describe('getRecentAgentRunsWithCost', () => {
  it('returns empty array for empty DB', () => {
    const result = getRecentAgentRunsWithCost(db)
    expect(result).toEqual([])
  })

  it('returns done/failed runs ordered by started_at desc', () => {
    const now = new Date().toISOString()
    const earlier = new Date(Date.now() - 60000).toISOString()
    db.prepare(
      `INSERT INTO agent_runs (id, bin, task, repo, status, started_at, cost_usd)
       VALUES (?, 'claude', 'task A', 'bde', 'done', ?, 0.05)`
    ).run('run-1', earlier)
    db.prepare(
      `INSERT INTO agent_runs (id, bin, task, repo, status, started_at, cost_usd)
       VALUES (?, 'claude', 'task B', 'bde', 'failed', ?, 0.10)`
    ).run('run-2', now)
    // Running tasks should not appear
    db.prepare(
      `INSERT INTO agent_runs (id, bin, task, repo, status, started_at)
       VALUES (?, 'claude', 'task C', 'bde', 'running', ?)`
    ).run('run-3', now)

    const result = getRecentAgentRunsWithCost(db)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('run-2') // most recent first
    expect(result[1].id).toBe('run-1')
  })

  it('respects the limit parameter', () => {
    const now = new Date().toISOString()
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO agent_runs (id, bin, status, started_at) VALUES (?, 'claude', 'done', ?)`
      ).run(`run-${i}`, now)
    }
    const result = getRecentAgentRunsWithCost(db, 2)
    expect(result).toHaveLength(2)
  })
})
