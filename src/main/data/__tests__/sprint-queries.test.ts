import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db'

// Create an in-memory SQLite DB with all migrations applied
let db: Database.Database

// Mock getDb to return our in-memory DB
vi.mock('../../db', async () => {
  const actual = await vi.importActual<typeof import('../../db')>('../../db')
  return {
    ...actual,
    getDb: () => db
  }
})

// Mock task-changes to spy on audit trail calls
const mockRecordTaskChanges = vi.fn()
vi.mock('../task-changes', () => ({
  recordTaskChanges: (...args: unknown[]) => mockRecordTaskChanges(...args)
}))

// Import AFTER mocks are set up
import {
  getTask,
  listTasks,
  listTasksRecent,
  createTask,
  updateTask,
  deleteTask,
  claimTask,
  releaseTask,
  getQueueStats,
  getDoneTodayCount,
  getActiveTaskCount,
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState,
  getQueuedTasks,
  getOrphanedTasks,
  getHealthCheckTasks,
  getTasksWithDependencies,
  clearSprintTaskFk,
  pruneOldDiffSnapshots,
  DIFF_SNAPSHOT_RETENTION_DAYS,
  UPDATE_ALLOWLIST
} from '../sprint-queries'

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
})

// Helper to insert a task directly for setup
function insertTask(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    title: 'Test task',
    prompt: 'Do the thing',
    repo: 'bde',
    status: 'backlog',
    priority: 1
  }
  const row = { ...defaults, ...overrides }
  const cols = Object.keys(row)
  const placeholders = cols.map(() => '?').join(', ')
  const stmt = db.prepare(`INSERT INTO sprint_tasks (${cols.join(', ')}) VALUES (${placeholders})`)
  stmt.run(...Object.values(row))
  // Return the last inserted task
  const lastId =
    overrides.id ?? db.prepare('SELECT id FROM sprint_tasks ORDER BY rowid DESC LIMIT 1').get()
  if (typeof lastId === 'object' && lastId !== null) {
    return (lastId as { id: string }).id
  }
  return lastId as string
}

describe('UPDATE_ALLOWLIST', () => {
  it('contains expected fields', () => {
    expect(UPDATE_ALLOWLIST.has('title')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('status')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('pr_url')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('agent_run_id')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('depends_on')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('playground_enabled')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('needs_review')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('max_runtime_ms')).toBe(true)
  })

  it('does not contain protected fields', () => {
    expect(UPDATE_ALLOWLIST.has('id')).toBe(false)
    expect(UPDATE_ALLOWLIST.has('created_at')).toBe(false)
    expect(UPDATE_ALLOWLIST.has('updated_at')).toBe(false)
  })
})

describe('createTask', () => {
  it('returns task with generated id', () => {
    const result = createTask({ title: 'New task', repo: 'bde' })
    expect(result).not.toBeNull()
    expect(result!.id).toBeTruthy()
    expect(typeof result!.id).toBe('string')
    expect(result!.id.length).toBeGreaterThan(0)
    expect(result!.title).toBe('New task')
    expect(result!.repo).toBe('bde')
  })

  it('applies default values', () => {
    const result = createTask({ title: 'Defaults', repo: 'bde' })!
    expect(result.status).toBe('backlog')
    expect(result.priority).toBe(0)
    expect(result.prompt).toBe('Defaults') // falls back to title
    expect(result.spec).toBeNull()
    expect(result.notes).toBeNull()
    expect(result.depends_on).toBeNull()
    expect(result.playground_enabled).toBe(false)
  })

  it('uses spec as prompt fallback', () => {
    const result = createTask({ title: 'T', repo: 'bde', spec: 'My spec' })!
    expect(result.prompt).toBe('My spec')
    expect(result.spec).toBe('My spec')
  })

  it('stores playground_enabled as boolean', () => {
    const result = createTask({ title: 'T', repo: 'bde', playground_enabled: true })!
    expect(result.playground_enabled).toBe(true)
  })

  it('serializes depends_on as JSON', () => {
    const deps = [{ id: 'dep-1', type: 'hard' as const }]
    const result = createTask({ title: 'T', repo: 'bde', depends_on: deps })!
    expect(result.depends_on).toEqual(deps)
  })

  it('sets created_at and updated_at', () => {
    const result = createTask({ title: 'T', repo: 'bde' })!
    expect(result.created_at).toBeTruthy()
    expect(result.updated_at).toBeTruthy()
  })
})

describe('getTask', () => {
  it('returns null for missing id', () => {
    const result = getTask('nonexistent')
    expect(result).toBeNull()
  })

  it('returns created task', () => {
    const created = createTask({ title: 'Find me', repo: 'bde' })!
    const found = getTask(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.title).toBe('Find me')
  })
})

describe('listTasks', () => {
  it('sorts by priority then created_at', () => {
    insertTask({ id: 'a', title: 'Low priority', priority: 5 })
    insertTask({ id: 'b', title: 'High priority', priority: 1 })
    insertTask({ id: 'c', title: 'Also high priority', priority: 1 })

    const tasks = listTasks()
    expect(tasks.length).toBe(3)
    // Priority 1 tasks first, then priority 5
    expect(tasks[0].priority).toBe(1)
    expect(tasks[1].priority).toBe(1)
    expect(tasks[2].priority).toBe(5)
    // Among same priority, ordered by created_at (insertion order for same timestamp)
    expect(tasks[0].id).toBe('b')
    expect(tasks[1].id).toBe('c')
  })

  it('filters by status', () => {
    insertTask({ id: 'a', status: 'backlog' })
    insertTask({ id: 'b', status: 'queued' })
    insertTask({ id: 'c', status: 'queued' })

    const queued = listTasks('queued')
    expect(queued.length).toBe(2)
    expect(queued.every((t) => t.status === 'queued')).toBe(true)
  })

  it('returns empty array when no tasks match', () => {
    const result = listTasks('active')
    expect(result).toEqual([])
  })
})

describe('listTasksRecent', () => {
  it('includes all non-terminal tasks', () => {
    insertTask({ id: 'a', status: 'backlog' })
    insertTask({ id: 'b', status: 'queued' })
    insertTask({ id: 'c', status: 'active' })
    insertTask({ id: 'd', status: 'review' })
    insertTask({ id: 'e', status: 'blocked' })

    const tasks = listTasksRecent()
    expect(tasks.length).toBe(5)
    expect(tasks.map((t) => t.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('includes terminal tasks completed within 7 days', () => {
    const now = new Date().toISOString()
    insertTask({ id: 'recent-done', status: 'done', completed_at: now })
    insertTask({ id: 'recent-failed', status: 'failed', completed_at: now })
    insertTask({ id: 'recent-cancelled', status: 'cancelled', completed_at: now })
    insertTask({ id: 'recent-error', status: 'error', completed_at: now })
    insertTask({ id: 'active', status: 'active' })

    const tasks = listTasksRecent()
    expect(tasks.length).toBe(5)
    expect(tasks.map((t) => t.id).sort()).toEqual([
      'active',
      'recent-cancelled',
      'recent-done',
      'recent-error',
      'recent-failed'
    ])
  })

  it('excludes terminal tasks completed more than 7 days ago', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    insertTask({ id: 'old-done', status: 'done', completed_at: eightDaysAgo })
    insertTask({ id: 'old-failed', status: 'failed', completed_at: eightDaysAgo })
    insertTask({ id: 'old-cancelled', status: 'cancelled', completed_at: eightDaysAgo })
    insertTask({ id: 'old-error', status: 'error', completed_at: eightDaysAgo })
    insertTask({ id: 'active', status: 'active' })

    const tasks = listTasksRecent()
    expect(tasks.length).toBe(1)
    expect(tasks[0].id).toBe('active')
  })

  it('sorts by priority then created_at', () => {
    insertTask({ id: 'a', title: 'Low priority', priority: 5, status: 'queued' })
    insertTask({ id: 'b', title: 'High priority', priority: 1, status: 'queued' })
    insertTask({ id: 'c', title: 'Also high priority', priority: 1, status: 'queued' })

    const tasks = listTasksRecent()
    expect(tasks.length).toBe(3)
    expect(tasks[0].priority).toBe(1)
    expect(tasks[1].priority).toBe(1)
    expect(tasks[2].priority).toBe(5)
    expect(tasks[0].id).toBe('b')
    expect(tasks[1].id).toBe('c')
  })

  it('returns empty array when no tasks exist', () => {
    const result = listTasksRecent()
    expect(result).toEqual([])
  })
})

describe('updateTask', () => {
  it('updates fields and returns updated task', () => {
    const created = createTask({ title: 'Original', repo: 'bde' })!
    const updated = updateTask(created.id, { title: 'Changed', priority: 5 })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Changed')
    expect(updated!.priority).toBe(5)
  })

  it('returns null when no allowed fields provided', () => {
    const created = createTask({ title: 'T', repo: 'bde' })!
    const result = updateTask(created.id, { id: 'hacked', created_at: 'hacked' })
    expect(result).toBeNull()
  })

  it('returns null for non-existent task', () => {
    const result = updateTask('nonexistent', { title: 'nope' })
    expect(result).toBeNull()
  })

  it('sanitizes depends_on on update', () => {
    const created = createTask({ title: 'T', repo: 'bde' })!
    const deps = [{ id: 'dep-1', type: 'hard' }]
    const updated = updateTask(created.id, { depends_on: deps })
    expect(updated!.depends_on).toEqual(deps)
  })

  it('records audit trail via recordTaskChanges', () => {
    const created = createTask({ title: 'Audit me', repo: 'bde' })!
    updateTask(created.id, { title: 'Audited' })
    expect(mockRecordTaskChanges).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ title: 'Audit me' }),
      expect.objectContaining({ title: 'Audited' }),
      'unknown',
      expect.anything()
    )
  })

  it('serializes booleans as 0/1 for SQLite', () => {
    const created = createTask({ title: 'T', repo: 'bde' })!
    const updated = updateTask(created.id, { playground_enabled: true, needs_review: true })
    expect(updated!.playground_enabled).toBe(true)
    expect(updated!.needs_review).toBe(true)

    // Verify raw SQLite stores INTEGER
    const raw = db
      .prepare('SELECT playground_enabled, needs_review FROM sprint_tasks WHERE id = ?')
      .get(created.id) as { playground_enabled: number; needs_review: number }
    expect(raw.playground_enabled).toBe(1)
    expect(raw.needs_review).toBe(1)
  })
})

describe('deleteTask', () => {
  it('removes the task', () => {
    const created = createTask({ title: 'Delete me', repo: 'bde' })!
    deleteTask(created.id)
    const found = getTask(created.id)
    expect(found).toBeNull()
  })

  it('does not throw for non-existent task', () => {
    expect(() => deleteTask('nonexistent')).not.toThrow()
  })
})

describe('claimTask', () => {
  it('atomically sets status to active', () => {
    const created = createTask({ title: 'Claim me', repo: 'bde' })!
    updateTask(created.id, { status: 'queued' })

    const claimed = claimTask(created.id, 'exec-1')
    expect(claimed).not.toBeNull()
    expect(claimed!.status).toBe('active')
    expect(claimed!.claimed_by).toBe('exec-1')
    expect(claimed!.started_at).toBeTruthy()
  })

  it('returns null if not queued', () => {
    const created = createTask({ title: 'Not queued', repo: 'bde' })!
    // status is 'backlog' by default
    const result = claimTask(created.id, 'exec-1')
    expect(result).toBeNull()
  })

  it('returns null for non-existent task', () => {
    const result = claimTask('nonexistent', 'exec-1')
    expect(result).toBeNull()
  })

  it('enforces WIP limit atomically when maxActive is provided', () => {
    // Use valid transitions: backlog → queued → active (via claimTask)
    const t1 = createTask({ title: 'Active 1', repo: 'bde' })!
    updateTask(t1.id, { status: 'queued' })
    claimTask(t1.id, 'setup-exec')
    const t2 = createTask({ title: 'Active 2', repo: 'bde' })!
    updateTask(t2.id, { status: 'queued' })
    claimTask(t2.id, 'setup-exec')

    const queued = createTask({ title: 'Should be blocked', repo: 'bde' })!
    updateTask(queued.id, { status: 'queued' })

    // WIP limit of 2 — should reject
    const result = claimTask(queued.id, 'exec-1', 2)
    expect(result).toBeNull()
    // Task must remain queued
    const unchanged = getTask(queued.id)
    expect(unchanged!.status).toBe('queued')
  })

  it('allows claim when active count is below maxActive', () => {
    // Use valid transitions: backlog → queued → active (via claimTask)
    const active = createTask({ title: 'Active', repo: 'bde' })!
    updateTask(active.id, { status: 'queued' })
    claimTask(active.id, 'setup-exec')

    const queued = createTask({ title: 'Claimable', repo: 'bde' })!
    updateTask(queued.id, { status: 'queued' })

    // WIP limit of 2 — one active, should allow
    const result = claimTask(queued.id, 'exec-1', 2)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('active')
  })
})

describe('releaseTask', () => {
  it('resets status to queued', () => {
    const created = createTask({ title: 'Release me', repo: 'bde' })!
    updateTask(created.id, { status: 'queued' })
    claimTask(created.id, 'exec-1')

    const released = releaseTask(created.id, 'exec-1')
    expect(released).not.toBeNull()
    expect(released!.status).toBe('queued')
    expect(released!.claimed_by).toBeNull()
    expect(released!.started_at).toBeNull()
    expect(released!.agent_run_id).toBeNull()
  })

  it('returns null if claimed_by does not match', () => {
    const created = createTask({ title: 'T', repo: 'bde' })!
    updateTask(created.id, { status: 'queued' })
    claimTask(created.id, 'exec-1')

    const result = releaseTask(created.id, 'exec-2')
    expect(result).toBeNull()
  })

  it('returns null if not active', () => {
    const created = createTask({ title: 'T', repo: 'bde' })!
    const result = releaseTask(created.id, 'exec-1')
    expect(result).toBeNull()
  })
})

describe('getQueueStats', () => {
  it('returns correct GROUP BY counts', () => {
    insertTask({ status: 'backlog' })
    insertTask({ status: 'backlog' })
    insertTask({ status: 'queued' })
    insertTask({ status: 'active' })
    insertTask({ status: 'done' })

    const stats = getQueueStats()
    expect(stats.backlog).toBe(2)
    expect(stats.queued).toBe(1)
    expect(stats.active).toBe(1)
    expect(stats.done).toBe(1)
    expect(stats.failed).toBe(0)
    expect(stats.cancelled).toBe(0)
    expect(stats.error).toBe(0)
    expect(stats.blocked).toBe(0)
  })

  it('returns all zeros when no tasks', () => {
    const stats = getQueueStats()
    expect(stats.backlog).toBe(0)
    expect(stats.queued).toBe(0)
    expect(stats.active).toBe(0)
    expect(stats.done).toBe(0)
  })
})

describe('getActiveTaskCount', () => {
  it('returns count of active tasks', () => {
    insertTask({ status: 'active' })
    insertTask({ status: 'active' })
    insertTask({ status: 'queued' })

    expect(getActiveTaskCount()).toBe(2)
  })

  it('returns 0 when no active tasks', () => {
    insertTask({ status: 'queued' })
    expect(getActiveTaskCount()).toBe(0)
  })

  it('returns Infinity on error', () => {
    // Close the DB to force an error
    db.close()
    const count = getActiveTaskCount()
    expect(count).toBe(Infinity)
    // Reopen for afterEach cleanup
    db = new Database(':memory:')
  })
})

describe('boolean field coercion', () => {
  it('playground_enabled coerced to true/false on read', () => {
    insertTask({ id: 'bool-1', playground_enabled: 1 })
    insertTask({ id: 'bool-0', playground_enabled: 0 })

    const t1 = getTask('bool-1')!
    const t0 = getTask('bool-0')!
    expect(t1.playground_enabled).toBe(true)
    expect(t0.playground_enabled).toBe(false)
  })

  it('needs_review coerced to true/false on read', () => {
    insertTask({ id: 'nr-1', needs_review: 1 })
    insertTask({ id: 'nr-0', needs_review: 0 })

    const t1 = getTask('nr-1')!
    const t0 = getTask('nr-0')!
    expect(t1.needs_review).toBe(true)
    expect(t0.needs_review).toBe(false)
  })
})

describe('depends_on serialization', () => {
  it('serialized as JSON string on write, deserialized on read', () => {
    const deps = [{ id: 'dep-1', type: 'hard' as const }]
    const created = createTask({ title: 'T', repo: 'bde', depends_on: deps })!

    // Verify raw storage is JSON string
    const raw = db.prepare('SELECT depends_on FROM sprint_tasks WHERE id = ?').get(created.id) as {
      depends_on: string
    }
    expect(typeof raw.depends_on).toBe('string')
    expect(JSON.parse(raw.depends_on)).toEqual(deps)

    // Verify read path deserializes
    const task = getTask(created.id)!
    expect(task.depends_on).toEqual(deps)
  })

  it('null depends_on stays null', () => {
    const created = createTask({ title: 'T', repo: 'bde' })!
    const task = getTask(created.id)!
    expect(task.depends_on).toBeNull()
  })
})

describe('markTaskDoneByPrNumber', () => {
  it('transitions active tasks to done, sets pr_status to merged', () => {
    insertTask({ id: 'pr-1', status: 'active', pr_number: 42, pr_status: 'open' })
    insertTask({ id: 'pr-2', status: 'active', pr_number: 42, pr_status: 'open' })
    insertTask({ id: 'other', status: 'active', pr_number: 99 })

    const affected = markTaskDoneByPrNumber(42)
    expect(affected).toContain('pr-1')
    expect(affected).toContain('pr-2')
    expect(affected).not.toContain('other')

    const t1 = getTask('pr-1')!
    expect(t1.status).toBe('done')
    expect(t1.completed_at).toBeTruthy()
    expect(t1.pr_status).toBe('merged')

    // Other task unchanged
    const other = getTask('other')!
    expect(other.status).toBe('active')
  })

  it('returns empty array when no matching tasks', () => {
    const result = markTaskDoneByPrNumber(999)
    expect(result).toEqual([])
  })
})

describe('markTaskCancelledByPrNumber', () => {
  it('transitions active tasks to cancelled', () => {
    insertTask({ id: 'pr-c1', status: 'active', pr_number: 50, pr_status: 'open' })

    const affected = markTaskCancelledByPrNumber(50)
    expect(affected).toContain('pr-c1')

    const t1 = getTask('pr-c1')!
    expect(t1.status).toBe('cancelled')
    expect(t1.completed_at).toBeTruthy()
  })

  it('sets pr_status to closed on done tasks with open PRs', () => {
    // A done task with an open PR for the same PR number
    insertTask({ id: 'pr-done', status: 'done', pr_number: 50, pr_status: 'open' })
    // An active task that will be cancelled
    insertTask({ id: 'pr-active', status: 'active', pr_number: 50, pr_status: 'open' })

    markTaskCancelledByPrNumber(50)

    const doneTask = getTask('pr-done')!
    expect(doneTask.pr_status).toBe('closed')

    const cancelledTask = getTask('pr-active')!
    expect(cancelledTask.status).toBe('cancelled')
  })

  it('returns empty array when no matching tasks', () => {
    const result = markTaskCancelledByPrNumber(999)
    expect(result).toEqual([])
  })
})

describe('getDoneTodayCount', () => {
  it('counts tasks completed today', () => {
    const now = new Date().toISOString()
    insertTask({ status: 'done', completed_at: now })
    insertTask({ status: 'done', completed_at: now })
    insertTask({ status: 'done', completed_at: '2020-01-01T00:00:00Z' }) // old

    expect(getDoneTodayCount()).toBe(2)
  })

  it('returns 0 when no tasks done today', () => {
    expect(getDoneTodayCount()).toBe(0)
  })
})

describe('listTasksWithOpenPrs', () => {
  it('returns tasks with pr_number and pr_status=open', () => {
    insertTask({ id: 'open-pr', pr_number: 42, pr_status: 'open' })
    insertTask({ id: 'merged-pr', pr_number: 43, pr_status: 'merged' })
    insertTask({ id: 'no-pr' })

    const result = listTasksWithOpenPrs()
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('open-pr')
  })
})

describe('updateTaskMergeableState', () => {
  it('updates mergeable state for matching pr_number', () => {
    insertTask({ id: 'ms-1', pr_number: 42 })
    updateTaskMergeableState(42, 'clean')

    const task = getTask('ms-1')!
    expect(task.pr_mergeable_state).toBe('clean')
  })

  it('does nothing when mergeableState is null', () => {
    insertTask({ id: 'ms-2', pr_number: 42 })
    updateTaskMergeableState(42, null)

    const task = getTask('ms-2')!
    expect(task.pr_mergeable_state).toBeNull()
  })
})

describe('getQueuedTasks', () => {
  it('returns queued tasks with null claimed_by, sorted and limited', () => {
    insertTask({ id: 'q1', status: 'queued', priority: 2, claimed_by: null })
    insertTask({ id: 'q2', status: 'queued', priority: 1, claimed_by: null })
    insertTask({ id: 'q3', status: 'queued', priority: 1, claimed_by: 'taken' })
    insertTask({ id: 'q4', status: 'active' })

    const result = getQueuedTasks(10)
    expect(result.length).toBe(2) // q1 and q2 (q3 is claimed, q4 is active)
    expect(result[0].id).toBe('q2') // priority 1 first
    expect(result[1].id).toBe('q1')
  })

  it('respects limit', () => {
    insertTask({ id: 'q1', status: 'queued' })
    insertTask({ id: 'q2', status: 'queued' })
    insertTask({ id: 'q3', status: 'queued' })

    const result = getQueuedTasks(2)
    expect(result.length).toBe(2)
  })
})

describe('getOrphanedTasks', () => {
  it('returns active tasks claimed by the given executor', () => {
    insertTask({ id: 'o1', status: 'active', claimed_by: 'exec-1' })
    insertTask({ id: 'o2', status: 'active', claimed_by: 'exec-2' })
    insertTask({ id: 'o3', status: 'queued', claimed_by: 'exec-1' })

    const result = getOrphanedTasks('exec-1')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('o1')
  })
})

describe('getHealthCheckTasks', () => {
  it('returns active tasks started more than 1 hour ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    insertTask({ id: 'old', status: 'active', started_at: twoHoursAgo })
    insertTask({ id: 'recent', status: 'active', started_at: fiveMinAgo })

    const result = getHealthCheckTasks()
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('old')
  })
})

describe('getTasksWithDependencies', () => {
  it('returns all tasks with depends_on parsed or null', () => {
    const deps = JSON.stringify([{ id: 'dep-1', type: 'hard' }])
    insertTask({ id: 'with-deps', depends_on: deps, status: 'blocked' })
    insertTask({ id: 'no-deps', status: 'backlog' })

    const result = getTasksWithDependencies()
    expect(result.length).toBe(2)
    const withDeps = result.find((t) => t.id === 'with-deps')!
    const noDeps = result.find((t) => t.id === 'no-deps')!
    expect(withDeps.depends_on).toEqual([{ id: 'dep-1', type: 'hard' }])
    expect(noDeps.depends_on).toBeNull()
  })
})

describe('clearSprintTaskFk', () => {
  it('clears agent_run_id for matching tasks', () => {
    insertTask({ id: 'fk-1', agent_run_id: 'run-123' })
    insertTask({ id: 'fk-2', agent_run_id: 'run-456' })

    clearSprintTaskFk('run-123')

    const t1 = getTask('fk-1')!
    expect(t1.agent_run_id).toBeNull()
    // Other task unchanged
    const t2 = getTask('fk-2')!
    expect(t2.agent_run_id).toBe('run-456')
  })
})

describe('pruneOldDiffSnapshots', () => {
  // Helper to insert a task with a specific updated_at (bypasses the trigger).
  function insertWithUpdatedAt(
    id: string,
    status: string,
    updatedAt: string,
    snapshot: string | null
  ): void {
    db.prepare(
      `INSERT INTO sprint_tasks (id, title, prompt, repo, status, priority, review_diff_snapshot, updated_at)
       VALUES (?, 'T', '', 'bde', ?, 1, ?, ?)`
    ).run(id, status, snapshot, updatedAt)
  }

  it('exports a default retention constant', () => {
    expect(DIFF_SNAPSHOT_RETENTION_DAYS).toBe(30)
  })

  it('clears review_diff_snapshot on terminal tasks older than retention window', () => {
    const old = new Date(Date.now() - 60 * 86400000).toISOString()
    insertWithUpdatedAt('old-done', 'done', old, '{"capturedAt":"x","totals":{},"files":[]}')
    insertWithUpdatedAt('old-failed', 'failed', old, '{"x":1}')
    insertWithUpdatedAt('old-cancelled', 'cancelled', old, '{"x":1}')
    insertWithUpdatedAt('old-error', 'error', old, '{"x":1}')

    const cleared = pruneOldDiffSnapshots(30)
    expect(cleared).toBe(4)

    for (const id of ['old-done', 'old-failed', 'old-cancelled', 'old-error']) {
      const t = getTask(id)!
      expect(t.review_diff_snapshot).toBeNull()
    }
  })

  it('preserves snapshots on tasks still in review status', () => {
    const old = new Date(Date.now() - 60 * 86400000).toISOString()
    insertWithUpdatedAt('still-review', 'review', old, '{"capturedAt":"x"}')

    const cleared = pruneOldDiffSnapshots(30)
    expect(cleared).toBe(0)

    const t = getTask('still-review')!
    expect(t.review_diff_snapshot).toBe('{"capturedAt":"x"}')
  })

  it('preserves recent terminal tasks', () => {
    const recent = new Date(Date.now() - 5 * 86400000).toISOString()
    insertWithUpdatedAt('recent-done', 'done', recent, '{"capturedAt":"x"}')

    const cleared = pruneOldDiffSnapshots(30)
    expect(cleared).toBe(0)

    const t = getTask('recent-done')!
    expect(t.review_diff_snapshot).toBe('{"capturedAt":"x"}')
  })

  it('respects custom retention window', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
    insertWithUpdatedAt('mid-done', 'done', tenDaysAgo, '{"capturedAt":"x"}')

    // 30-day window — should NOT prune
    expect(pruneOldDiffSnapshots(30)).toBe(0)
    expect(getTask('mid-done')!.review_diff_snapshot).toBe('{"capturedAt":"x"}')

    // 5-day window — SHOULD prune
    expect(pruneOldDiffSnapshots(5)).toBe(1)
    expect(getTask('mid-done')!.review_diff_snapshot).toBeNull()
  })
})
