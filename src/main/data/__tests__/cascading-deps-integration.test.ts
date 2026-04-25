/**
 * Cascading dependency integration test.
 *
 * Uses real in-memory SQLite + migrations + the actual resolveDependents function
 * to verify that completing the first task in a 3-task chain unblocks the second,
 * which in turn unblocks the third.
 *
 * This complements the mocked-dependency tests in resolve-dependents.test.ts
 * by exercising the real data layer together with the resolver.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db'
import { resolveDependents } from '../../lib/resolve-dependents'
import { createDependencyIndex } from '../../services/dependency-service'
import type { SprintTask, TaskDependency } from '../../../shared/types'

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

function insertTask(
  id: string,
  status: string,
  dependsOn: TaskDependency[] | null = null
): void {
  db.prepare(
    `INSERT INTO sprint_tasks (id, title, repo, status, priority, depends_on)
     VALUES (?, ?, 'bde', ?, 1, ?)`
  ).run(id, `Task ${id}`, status, dependsOn ? JSON.stringify(dependsOn) : null)
}

function readTask(id: string): { status: string; depends_on: string | null } {
  return db
    .prepare('SELECT status, depends_on FROM sprint_tasks WHERE id = ?')
    .get(id) as { status: string; depends_on: string | null }
}

function getTaskForResolver(id: string): (Pick<SprintTask, 'id' | 'status' | 'notes' | 'title' | 'group_id'> & { depends_on: TaskDependency[] | null }) | null {
  const row = db
    .prepare('SELECT id, status, notes, title, depends_on FROM sprint_tasks WHERE id = ?')
    .get(id) as { id: string; status: string; notes: string | null; title: string; depends_on: string | null; group_id?: string | null } | undefined

  if (!row) return null

  return {
    ...row,
    group_id: row.group_id ?? null,
    depends_on: row.depends_on ? (JSON.parse(row.depends_on) as TaskDependency[]) : null
  }
}

function updateTaskStatus(id: string, status: string): void {
  db.prepare("UPDATE sprint_tasks SET status = ? WHERE id = ?").run(status, id)
}

describe('3-task cascading dependency chain', () => {
  it('unblocks the second task when the first completes, then unblocks the third when the second completes', () => {
    // A → B (hard) → C (hard)
    insertTask('task-a', 'queued')
    insertTask('task-b', 'blocked', [{ id: 'task-a', type: 'hard' }])
    insertTask('task-c', 'blocked', [{ id: 'task-b', type: 'hard' }])

    const index = createDependencyIndex()
    index.rebuild([
      { id: 'task-a', depends_on: null },
      { id: 'task-b', depends_on: [{ id: 'task-a', type: 'hard' }] },
      { id: 'task-c', depends_on: [{ id: 'task-b', type: 'hard' }] }
    ] as SprintTask[])

    // Step 1: complete task-a → task-b should unblock
    updateTaskStatus('task-a', 'done')
    resolveDependents(
      'task-a',
      'done',
      index,
      getTaskForResolver,
      (id, patch) => updateTaskStatus(id, patch.status as string)
    )

    expect(readTask('task-b').status).toBe('queued')
    expect(readTask('task-c').status).toBe('blocked')

    // Step 2: complete task-b → task-c should unblock
    updateTaskStatus('task-b', 'done')
    resolveDependents(
      'task-b',
      'done',
      index,
      getTaskForResolver,
      (id, patch) => updateTaskStatus(id, patch.status as string)
    )

    expect(readTask('task-c').status).toBe('queued')
  })

  it('does not unblock downstream blocked tasks when the upstream fails (hard dependency)', () => {
    insertTask('task-a', 'queued')
    insertTask('task-b', 'blocked', [{ id: 'task-a', type: 'hard' }])
    insertTask('task-c', 'blocked', [{ id: 'task-b', type: 'hard' }])

    const index = createDependencyIndex()
    index.rebuild([
      { id: 'task-a', depends_on: null },
      { id: 'task-b', depends_on: [{ id: 'task-a', type: 'hard' }] },
      { id: 'task-c', depends_on: [{ id: 'task-b', type: 'hard' }] }
    ] as SprintTask[])

    updateTaskStatus('task-a', 'failed')
    resolveDependents(
      'task-a',
      'failed',
      index,
      getTaskForResolver,
      (id, patch) => updateTaskStatus(id, patch.status as string)
    )

    // task-b has hard dep on task-a — should remain blocked since task-a failed
    expect(readTask('task-b').status).toBe('blocked')
    expect(readTask('task-c').status).toBe('blocked')
  })

  it('unblocks a downstream task with a soft dependency even when upstream fails', () => {
    insertTask('task-a', 'queued')
    insertTask('task-b', 'blocked', [{ id: 'task-a', type: 'soft' }])

    const index = createDependencyIndex()
    index.rebuild([
      { id: 'task-a', depends_on: null },
      { id: 'task-b', depends_on: [{ id: 'task-a', type: 'soft' }] }
    ] as SprintTask[])

    updateTaskStatus('task-a', 'failed')
    resolveDependents(
      'task-a',
      'failed',
      index,
      getTaskForResolver,
      (id, patch) => updateTaskStatus(id, patch.status as string)
    )

    expect(readTask('task-b').status).toBe('queued')
  })
})
