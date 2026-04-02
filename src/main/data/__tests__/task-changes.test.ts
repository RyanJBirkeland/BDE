import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import { recordTaskChanges, getTaskChanges, pruneOldChanges } from '../task-changes'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('recordTaskChanges', () => {
  it('records field-level diffs', () => {
    const oldTask = { status: 'backlog', title: 'Do stuff', priority: 1 }
    const newPatch = { status: 'queued', priority: 2 }

    recordTaskChanges('task-1', oldTask, newPatch, 'user', db)

    const changes = getTaskChanges('task-1', 50, db)
    expect(changes).toHaveLength(2)

    const fields = changes.map((c) => c.field).sort()
    expect(fields).toEqual(['priority', 'status'])

    const statusChange = changes.find((c) => c.field === 'status')!
    expect(statusChange.old_value).toBe('"backlog"')
    expect(statusChange.new_value).toBe('"queued"')
    expect(statusChange.changed_by).toBe('user')
  })

  it('ignores unchanged fields', () => {
    const oldTask = { status: 'queued', title: 'Same' }
    const newPatch = { status: 'queued', title: 'Same' }

    recordTaskChanges('task-2', oldTask, newPatch, 'user', db)

    const changes = getTaskChanges('task-2', 50, db)
    expect(changes).toHaveLength(0)
  })

  it('handles null to value transitions', () => {
    const oldTask = { notes: null }
    const newPatch = { notes: 'Added notes' }

    recordTaskChanges('task-3', oldTask, newPatch, 'user', db)

    const changes = getTaskChanges('task-3', 50, db)
    expect(changes).toHaveLength(1)
    expect(changes[0].old_value).toBeNull()
    expect(changes[0].new_value).toBe('"Added notes"')
  })

  it('handles value to null transitions', () => {
    const oldTask = { notes: 'Had notes' }
    const newPatch = { notes: null }

    recordTaskChanges('task-4', oldTask, newPatch, 'user', db)

    const changes = getTaskChanges('task-4', 50, db)
    expect(changes).toHaveLength(1)
    expect(changes[0].old_value).toBe('"Had notes"')
    expect(changes[0].new_value).toBeNull()
  })

  it('handles complex values like depends_on arrays', () => {
    const oldTask = { depends_on: [{ id: 'a', type: 'hard' }] }
    const newPatch = {
      depends_on: [
        { id: 'a', type: 'hard' },
        { id: 'b', type: 'soft' }
      ]
    }

    recordTaskChanges('task-5', oldTask, newPatch, 'user', db)

    const changes = getTaskChanges('task-5', 50, db)
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe('depends_on')
  })
})

describe('getTaskChanges', () => {
  it('returns changes ordered by most recent first', () => {
    const stmt = db.prepare(
      'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    stmt.run('task-6', 'status', '"backlog"', '"queued"', 'user', '2026-01-01T00:00:00.000Z')
    stmt.run('task-6', 'status', '"queued"', '"active"', 'agent', '2026-01-02T00:00:00.000Z')
    stmt.run('task-6', 'status', '"active"', '"done"', 'agent', '2026-01-03T00:00:00.000Z')

    const changes = getTaskChanges('task-6', 50, db)
    expect(changes).toHaveLength(3)
    expect(changes[0].new_value).toBe('"done"')
    expect(changes[1].new_value).toBe('"active"')
    expect(changes[2].new_value).toBe('"queued"')
  })

  it('respects limit parameter', () => {
    const stmt = db.prepare(
      'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    stmt.run('task-7', 'status', '"a"', '"b"', 'user', '2026-01-01T00:00:00.000Z')
    stmt.run('task-7', 'status', '"b"', '"c"', 'user', '2026-01-02T00:00:00.000Z')
    stmt.run('task-7', 'status', '"c"', '"d"', 'user', '2026-01-03T00:00:00.000Z')

    const changes = getTaskChanges('task-7', 2, db)
    expect(changes).toHaveLength(2)
  })

  it('returns empty array for unknown task', () => {
    const changes = getTaskChanges('nonexistent', 50, db)
    expect(changes).toEqual([])
  })
})

describe('pruneOldChanges', () => {
  it('removes records older than threshold', () => {
    const stmt = db.prepare(
      'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const oldDate = new Date(Date.now() - 60 * 86400000).toISOString()
    const recentDate = new Date(Date.now() - 1 * 86400000).toISOString()

    stmt.run('task-8', 'status', '"a"', '"b"', 'user', oldDate)
    stmt.run('task-8', 'notes', null, '"hi"', 'user', recentDate)

    const pruned = pruneOldChanges(30, db)
    expect(pruned).toBe(1)

    const remaining = getTaskChanges('task-8', 50, db)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].field).toBe('notes')
  })

  it('keeps all records when none are old enough', () => {
    const recentDate = new Date(Date.now() - 1000).toISOString()
    db.prepare(
      'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('task-9', 'status', '"a"', '"b"', 'user', recentDate)

    const pruned = pruneOldChanges(30, db)
    expect(pruned).toBe(0)

    expect(getTaskChanges('task-9', 50, db)).toHaveLength(1)
  })
})
