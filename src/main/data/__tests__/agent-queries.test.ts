import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import {
  insertAgentRecord,
  getAgentMeta,
  updateAgentMeta,
  findAgentByPid,
  listAgents,
  hasAgent,
  countAgents,
  deleteAgent,
  getAgentLogPath,
  getAgentsToRemove,
  updateAgentRunCost,
  listAgentRunsByTaskId
} from '../agent-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    pid: 1234,
    bin: 'claude',
    model: 'opus',
    repo: 'bde',
    repoPath: '/tmp/bde',
    task: 'fix tests',
    startedAt: '2025-01-01T00:00:00Z',
    finishedAt: null,
    exitCode: null,
    status: 'running' as const,
    logPath: '/tmp/log.txt',
    source: 'bde' as const,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    sprintTaskId: null,
    ...overrides
  }
}

describe('insertAgentRecord + getAgentMeta', () => {
  it('inserts and retrieves an agent record', () => {
    const meta = makeAgent()
    insertAgentRecord(db, meta)
    const result = getAgentMeta(db, 'agent-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('agent-1')
    expect(result!.pid).toBe(1234)
    expect(result!.bin).toBe('claude')
    expect(result!.model).toBe('opus')
    expect(result!.repo).toBe('bde')
    expect(result!.repoPath).toBe('/tmp/bde')
    expect(result!.task).toBe('fix tests')
    expect(result!.status).toBe('running')
    expect(result!.logPath).toBe('/tmp/log.txt')
    expect(result!.source).toBe('bde')
  })

  it('returns null for a missing ID', () => {
    expect(getAgentMeta(db, 'nonexistent')).toBeNull()
  })
})

describe('updateAgentMeta', () => {
  it('updates status and exitCode', () => {
    insertAgentRecord(db, makeAgent())
    const row = updateAgentMeta(db, 'agent-1', { status: 'done', exitCode: 0 })
    expect(row).not.toBeNull()
    expect(row!.status).toBe('done')
    expect(row!.exit_code).toBe(0)
  })

  it('returns null when patch has no recognized fields', () => {
    insertAgentRecord(db, makeAgent())
    const result = updateAgentMeta(db, 'agent-1', {})
    expect(result).toBeNull()
  })

  it('returns null/undefined for non-existent agent', () => {
    const result = updateAgentMeta(db, 'ghost', { status: 'done' })
    // UPDATE affects 0 rows, SELECT returns undefined (better-sqlite3 .get() on no match)
    expect(result).toBeFalsy()
  })
})

describe('findAgentByPid', () => {
  it('finds a running agent by PID', () => {
    insertAgentRecord(db, makeAgent({ pid: 9999 }))
    const result = findAgentByPid(db, 9999)
    expect(result).not.toBeNull()
    expect(result!.pid).toBe(9999)
  })

  it('returns null when no running agent has that PID', () => {
    insertAgentRecord(db, makeAgent({ pid: 9999, status: 'done' }))
    expect(findAgentByPid(db, 9999)).toBeNull()
  })

  it('returns null for unknown PID', () => {
    expect(findAgentByPid(db, 42)).toBeNull()
  })
})

describe('listAgents', () => {
  it('returns all agents', () => {
    insertAgentRecord(db, makeAgent({ id: 'a1' }))
    insertAgentRecord(db, makeAgent({ id: 'a2' }))
    const all = listAgents(db)
    expect(all).toHaveLength(2)
  })

  it('filters by status', () => {
    insertAgentRecord(db, makeAgent({ id: 'a1', status: 'running' }))
    insertAgentRecord(db, makeAgent({ id: 'a2', status: 'done' }))
    const running = listAgents(db, 100, 'running')
    expect(running).toHaveLength(1)
    expect(running[0].id).toBe('a1')
  })

  it('returns empty array when no agents exist', () => {
    expect(listAgents(db)).toHaveLength(0)
  })
})

describe('hasAgent', () => {
  it('returns true when agent exists', () => {
    insertAgentRecord(db, makeAgent())
    expect(hasAgent(db, 'agent-1')).toBe(true)
  })

  it('returns false when agent does not exist', () => {
    expect(hasAgent(db, 'ghost')).toBe(false)
  })
})

describe('countAgents', () => {
  it('returns 0 for empty DB', () => {
    expect(countAgents(db)).toBe(0)
  })

  it('counts all agents', () => {
    insertAgentRecord(db, makeAgent({ id: 'a1' }))
    insertAgentRecord(db, makeAgent({ id: 'a2' }))
    expect(countAgents(db)).toBe(2)
  })
})

describe('deleteAgent', () => {
  it('removes an agent', () => {
    insertAgentRecord(db, makeAgent())
    expect(hasAgent(db, 'agent-1')).toBe(true)
    deleteAgent(db, 'agent-1')
    expect(hasAgent(db, 'agent-1')).toBe(false)
  })

  it('does nothing for non-existent agent', () => {
    expect(() => deleteAgent(db, 'ghost')).not.toThrow()
  })
})

describe('getAgentLogPath', () => {
  it('returns log path for existing agent', () => {
    insertAgentRecord(db, makeAgent({ logPath: '/logs/a.txt' }))
    expect(getAgentLogPath(db, 'agent-1')).toBe('/logs/a.txt')
  })

  it('returns null for missing agent', () => {
    expect(getAgentLogPath(db, 'ghost')).toBeNull()
  })
})

describe('getAgentsToRemove', () => {
  it('returns agents beyond the max count', () => {
    insertAgentRecord(db, makeAgent({ id: 'a1', startedAt: '2025-01-01T00:00:00Z' }))
    insertAgentRecord(db, makeAgent({ id: 'a2', startedAt: '2025-01-02T00:00:00Z' }))
    insertAgentRecord(db, makeAgent({ id: 'a3', startedAt: '2025-01-03T00:00:00Z' }))
    // Keep 2 most recent, get the rest
    const toRemove = getAgentsToRemove(db, 2)
    expect(toRemove).toHaveLength(1)
    expect(toRemove[0].id).toBe('a1')
  })
})

describe('updateAgentRunCost', () => {
  it('updates cost columns on an agent run', () => {
    insertAgentRecord(db, makeAgent())
    updateAgentRunCost(db, 'agent-1', {
      costUsd: 0.05,
      tokensIn: 1000,
      tokensOut: 500,
      cacheRead: 200,
      cacheCreate: 100,
      durationMs: 30000,
      numTurns: 5
    })
    const row = db
      .prepare('SELECT cost_usd, tokens_in, tokens_out, num_turns FROM agent_runs WHERE id = ?')
      .get('agent-1') as {
      cost_usd: number
      tokens_in: number
      tokens_out: number
      num_turns: number
    }
    expect(row.cost_usd).toBe(0.05)
    expect(row.tokens_in).toBe(1000)
    expect(row.tokens_out).toBe(500)
    expect(row.num_turns).toBe(5)
  })
})

describe('rowToMeta includes cost fields and sprintTaskId', () => {
  it('maps cost columns and sprint_task_id to camelCase', () => {
    insertAgentRecord(
      db,
      makeAgent({
        costUsd: 0.45,
        tokensIn: 12000,
        tokensOut: 3400,
        sprintTaskId: 'task-abc'
      })
    )
    const result = getAgentMeta(db, 'agent-1')
    expect(result).not.toBeNull()
    expect(result!.costUsd).toBe(0.45)
    expect(result!.tokensIn).toBe(12000)
    expect(result!.tokensOut).toBe(3400)
    expect(result!.sprintTaskId).toBe('task-abc')
  })

  it('returns null cost fields when not set', () => {
    insertAgentRecord(db, makeAgent())
    const result = getAgentMeta(db, 'agent-1')
    expect(result).not.toBeNull()
    expect(result!.costUsd).toBeNull()
    expect(result!.tokensIn).toBeNull()
    expect(result!.tokensOut).toBeNull()
    expect(result!.sprintTaskId).toBeNull()
  })
})

describe('listAgentRunsByTaskId', () => {
  it('returns runs filtered by sprint_task_id', () => {
    insertAgentRecord(
      db,
      makeAgent({ id: 'run-1', sprintTaskId: 'task-A', startedAt: '2025-01-01T00:00:00Z' })
    )
    insertAgentRecord(
      db,
      makeAgent({ id: 'run-2', sprintTaskId: 'task-A', startedAt: '2025-01-02T00:00:00Z' })
    )
    insertAgentRecord(
      db,
      makeAgent({ id: 'run-3', sprintTaskId: 'task-B', startedAt: '2025-01-03T00:00:00Z' })
    )

    const runs = listAgentRunsByTaskId(db, 'task-A')
    expect(runs).toHaveLength(2)
    expect(runs[0].id).toBe('run-2') // most recent first
    expect(runs[1].id).toBe('run-1')
  })

  it('returns all runs when no taskId filter', () => {
    insertAgentRecord(db, makeAgent({ id: 'run-1', sprintTaskId: 'task-A' }))
    insertAgentRecord(db, makeAgent({ id: 'run-2', sprintTaskId: null }))

    const runs = listAgentRunsByTaskId(db)
    expect(runs).toHaveLength(2)
  })

  it('respects limit parameter', () => {
    insertAgentRecord(
      db,
      makeAgent({ id: 'run-1', sprintTaskId: 'task-A', startedAt: '2025-01-01T00:00:00Z' })
    )
    insertAgentRecord(
      db,
      makeAgent({ id: 'run-2', sprintTaskId: 'task-A', startedAt: '2025-01-02T00:00:00Z' })
    )
    insertAgentRecord(
      db,
      makeAgent({ id: 'run-3', sprintTaskId: 'task-A', startedAt: '2025-01-03T00:00:00Z' })
    )

    const runs = listAgentRunsByTaskId(db, 'task-A', 2)
    expect(runs).toHaveLength(2)
  })

  it('returns empty array when no matching runs', () => {
    const runs = listAgentRunsByTaskId(db, 'nonexistent')
    expect(runs).toEqual([])
  })
})
