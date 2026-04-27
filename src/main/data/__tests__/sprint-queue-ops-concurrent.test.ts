/**
 * Honest integration tests for claimTask and getOrphanedTasks.
 *
 * Uses real in-memory SQLite with all migrations applied.
 * better-sqlite3 is synchronous, so "concurrent" here means two calls
 * to the same queued task before either commits — the atomic
 * `UPDATE … WHERE status = 'queued'` predicate ensures exactly one wins.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db'
import { claimTask } from '../sprint-queue-ops'
import { getOrphanedTasks } from '../sprint-agent-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

function insertQueuedTask(id: string, title = 'Test task'): void {
  db.prepare(
    `INSERT INTO sprint_tasks (id, title, repo, status, priority)
     VALUES (?, ?, 'bde', 'queued', 1)`
  ).run(id, title)
}

function insertActiveTask(id: string, claimedBy: string): void {
  db.prepare(
    `INSERT INTO sprint_tasks (id, title, repo, status, priority, claimed_by)
     VALUES (?, ?, 'bde', 'active', 1, ?)`
  ).run(id, `Task ${id}`, claimedBy)
}

function getTaskRow(id: string): { status: string; claimed_by: string | null } {
  return db
    .prepare('SELECT status, claimed_by FROM sprint_tasks WHERE id = ?')
    .get(id) as { status: string; claimed_by: string | null }
}

describe('claimTask concurrent-claim race', () => {
  it('allows exactly one caller to win when two callers attempt to claim the same queued task', async () => {
    const taskId = 'race-task-1'
    insertQueuedTask(taskId)

    const firstResult = await claimTask(taskId, 'executor-a', undefined, db)
    const secondResult = await claimTask(taskId, 'executor-b', undefined, db)

    const winners = [firstResult, secondResult].filter((r) => r !== null)
    const losers = [firstResult, secondResult].filter((r) => r === null)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(firstResult).not.toBeNull()
    expect(firstResult!.claimed_by).toBe('executor-a')
    expect(secondResult).toBeNull()
  })

  it('leaves the task in active status with the winner as claimed_by after a race', async () => {
    const taskId = 'race-task-2'
    insertQueuedTask(taskId)

    await claimTask(taskId, 'executor-winner', undefined, db)
    await claimTask(taskId, 'executor-loser', undefined, db)

    const stored = getTaskRow(taskId)
    expect(stored.status).toBe('active')
    expect(stored.claimed_by).toBe('executor-winner')
  })

  it('returns the claimed task with correct fields for the winner', async () => {
    const taskId = 'race-task-3'
    insertQueuedTask(taskId, 'Claimable task')

    const claimed = await claimTask(taskId, 'executor-first', undefined, db)

    expect(claimed).not.toBeNull()
    expect(claimed!.id).toBe(taskId)
    expect(claimed!.status).toBe('active')
    expect(claimed!.claimed_by).toBe('executor-first')
    expect(claimed!.started_at).not.toBeNull()
  })

  it('returns null when no queued task exists with the given id', async () => {
    const result = await claimTask('nonexistent-id', 'executor-a', undefined, db)
    expect(result).toBeNull()
  })
})

describe('getOrphanedTasks orphan recovery round-trip', () => {
  it('returns an active task claimed by the given executor', () => {
    const taskId = 'orphan-task-1'
    insertActiveTask(taskId, 'bde-embedded')

    const orphans = getOrphanedTasks('bde-embedded', db)

    expect(orphans).toHaveLength(1)
    expect(orphans[0].id).toBe(taskId)
    expect(orphans[0].status).toBe('active')
  })

  it('does not return tasks claimed by a different executor', () => {
    insertActiveTask('task-other', 'other-executor')

    const orphans = getOrphanedTasks('bde-embedded', db)
    expect(orphans).toHaveLength(0)
  })

  it('does not return queued tasks — only active ones are orphans', () => {
    insertQueuedTask('queued-task')

    const orphans = getOrphanedTasks('bde-embedded', db)
    expect(orphans).toHaveLength(0)
  })

  it('round-trip: seed active task, re-queue it, assert status=queued and orphan_recovery_count=1', () => {
    const taskId = 'orphan-round-trip'
    insertActiveTask(taskId, 'bde-embedded')

    const orphansBefore = getOrphanedTasks('bde-embedded', db)
    expect(orphansBefore).toHaveLength(1)
    expect(orphansBefore[0].orphan_recovery_count).toBe(0)

    // Simulate what recoverOrphans does: update status=queued and increment count
    db.prepare(
      `UPDATE sprint_tasks
       SET status = 'queued', claimed_by = NULL, orphan_recovery_count = orphan_recovery_count + 1
       WHERE id = ?`
    ).run(taskId)

    const orphansAfter = getOrphanedTasks('bde-embedded', db)
    expect(orphansAfter).toHaveLength(0)

    const stored = db
      .prepare('SELECT status, claimed_by, orphan_recovery_count FROM sprint_tasks WHERE id = ?')
      .get(taskId) as { status: string; claimed_by: string | null; orphan_recovery_count: number }
    expect(stored.status).toBe('queued')
    expect(stored.claimed_by).toBeNull()
    expect(stored.orphan_recovery_count).toBe(1)
  })
})
