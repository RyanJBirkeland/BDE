/**
 * Integration tests: retry backoff for requeued tasks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

// Mock broadcast to prevent Electron import
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn()
}))

vi.mock('../../db', () => {
  let _db: Database.Database | null = null
  return {
    getDb: () => {
      if (!_db) {
        _db = new Database(':memory:')
        _db.pragma('foreign_keys = ON')
        _db.exec(`
          CREATE TABLE sprint_tasks (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            title TEXT NOT NULL DEFAULT '',
            repo TEXT NOT NULL DEFAULT '',
            prompt TEXT NOT NULL DEFAULT '',
            spec TEXT, notes TEXT,
            priority INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'backlog',
            template_name TEXT, depends_on TEXT,
            playground_enabled INTEGER NOT NULL DEFAULT 0,
            needs_review INTEGER NOT NULL DEFAULT 0,
            max_runtime_ms INTEGER, spec_type TEXT, agent_run_id TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            fast_fail_count INTEGER NOT NULL DEFAULT 0,
            pr_url TEXT, pr_number INTEGER, pr_status TEXT, pr_mergeable_state TEXT,
            claimed_by TEXT, started_at TEXT, completed_at TEXT,
            worktree_path TEXT, session_id TEXT, next_eligible_at TEXT,
            model TEXT, retry_context TEXT, failure_reason TEXT,
            max_cost_usd REAL, partial_diff TEXT, assigned_reviewer TEXT,
            tags TEXT, sprint_id TEXT, group_id TEXT, review_diff_snapshot TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          )
        `)
        _db.exec(`
          CREATE TABLE task_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL, field TEXT NOT NULL,
            old_value TEXT, new_value TEXT,
            changed_by TEXT NOT NULL DEFAULT 'unknown',
            changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          )
        `)
      }
      return _db
    }
  }
})

import { getDb } from '../../db'
import { getQueuedTasks } from '../../data/sprint-queries'
import { resolveFailure } from '../../agent-manager/completion'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'

function insertTask(
  overrides: {
    id?: string
    status?: string
    claimed_by?: string | null
    next_eligible_at?: string | null
    retry_count?: number
  } = {}
): string {
  const db = getDb()
  const id = overrides.id ?? `task-${Math.random().toString(36).slice(2)}`
  db.prepare(
    `INSERT INTO sprint_tasks (id, title, repo, prompt, status, claimed_by, next_eligible_at, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    'Test task',
    'bde',
    'Test prompt',
    overrides.status ?? 'queued',
    overrides.claimed_by ?? null,
    overrides.next_eligible_at ?? null,
    overrides.retry_count ?? 0
  )
  return id
}

function clearTasks(): void {
  getDb().exec('DELETE FROM sprint_tasks')
  getDb().exec('DELETE FROM task_changes')
}

function makeMockRepo(): { repo: ISprintTaskRepository; updateTaskMock: ReturnType<typeof vi.fn> } {
  const updateTaskMock = vi.fn().mockReturnValue(null)
  const repo: ISprintTaskRepository = {
    getTask: vi.fn(),
    updateTask: updateTaskMock,
    getQueuedTasks: vi.fn(),
    getTasksWithDependencies: vi.fn(),
    getOrphanedTasks: vi.fn(),
    getActiveTaskCount: vi.fn(),
    claimTask: vi.fn()
  }
  return { repo, updateTaskMock }
}

describe('retry backoff: getQueuedTasks filtering', () => {
  beforeEach(() => {
    clearTasks()
  })

  it('returns tasks with next_eligible_at = NULL (backward compatibility)', () => {
    insertTask({ next_eligible_at: null })
    expect(getQueuedTasks(10)).toHaveLength(1)
  })

  it('returns tasks with next_eligible_at in the past', () => {
    insertTask({ next_eligible_at: new Date(Date.now() - 60000).toISOString() })
    expect(getQueuedTasks(10)).toHaveLength(1)
  })

  it('excludes tasks with next_eligible_at in the future', () => {
    insertTask({ next_eligible_at: new Date(Date.now() + 60000).toISOString() })
    expect(getQueuedTasks(10)).toHaveLength(0)
  })

  it('only returns unclaimed queued tasks (pre-existing behavior)', () => {
    insertTask({ claimed_by: 'bde-embedded' })
    expect(getQueuedTasks(10)).toHaveLength(0)
  })

  it('returns eligible tasks and excludes ineligible tasks in the same query', () => {
    const eligibleId = insertTask({ next_eligible_at: new Date(Date.now() - 60000).toISOString() })
    insertTask({ next_eligible_at: new Date(Date.now() + 60000).toISOString() })
    insertTask({ next_eligible_at: null })

    const tasks = getQueuedTasks(10)
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.id)).toContain(eligibleId)
  })
})

describe('retry backoff: resolveFailure sets next_eligible_at', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets next_eligible_at when requeuing on first retry (retry_count=0, 30s backoff)', () => {
    const { repo, updateTaskMock } = makeMockRepo()
    const before = Date.now()
    resolveFailure({ taskId: 'task-1', retryCount: 0, repo })
    const after = Date.now()

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'queued',
        retry_count: 1,
        claimed_by: null,
        next_eligible_at: expect.any(String)
      })
    )

    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    const eligibleAt = new Date(patch.next_eligible_at as string).getTime()
    // retryCount=0: min(300000, 30000 * 2^0) = 30000ms
    expect(eligibleAt).toBeGreaterThanOrEqual(before + 29000)
    expect(eligibleAt).toBeLessThanOrEqual(after + 31000)
  })

  it('doubles backoff on second retry (retry_count=1, 60s backoff)', () => {
    const { repo, updateTaskMock } = makeMockRepo()
    const before = Date.now()
    resolveFailure({ taskId: 'task-1', retryCount: 1, repo })
    const after = Date.now()

    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    const eligibleAt = new Date(patch.next_eligible_at as string).getTime()
    // retryCount=1: min(300000, 30000 * 2^1) = 60000ms
    expect(eligibleAt).toBeGreaterThanOrEqual(before + 59000)
    expect(eligibleAt).toBeLessThanOrEqual(after + 61000)
  })

  it('third retry uses 120s backoff (max before terminal)', () => {
    const { repo, updateTaskMock } = makeMockRepo()
    const before = Date.now()
    resolveFailure({ taskId: 'task-1', retryCount: 2, repo })
    const after = Date.now()

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'queued',
        retry_count: 3
      })
    )

    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    const eligibleAt = new Date(patch.next_eligible_at as string).getTime()
    // retryCount=2: min(300000, 30000 * 2^2) = 120000ms
    expect(eligibleAt).toBeGreaterThanOrEqual(before + 119000)
    expect(eligibleAt).toBeLessThanOrEqual(after + 121000)
  })

  it('does NOT set next_eligible_at when task is terminal (retries exhausted)', () => {
    const { repo, updateTaskMock } = makeMockRepo()
    // MAX_RETRIES is 3
    resolveFailure({ taskId: 'task-1', retryCount: 3, repo })

    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'failed' })
    )
    const patch = updateTaskMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.next_eligible_at).toBeUndefined()
  })
})
