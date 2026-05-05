import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runMigrations } from '../../db'
import {
  createPrGroup,
  getPrGroup,
  listPrGroups,
  updatePrGroup,
  addTaskToGroup,
  removeTaskFromGroup,
  deletePrGroup,
  setPrGroupQueriesLogger
} from '../pr-group-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('createPrGroup', () => {
  it('creates a group with correct defaults', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'My PR Group', branchName: 'pr/my-group' }, db)

    expect(group).not.toBeNull()
    expect(group!.repo).toBe('fleet')
    expect(group!.title).toBe('My PR Group')
    expect(group!.branch_name).toBe('pr/my-group')
    expect(group!.description).toBeNull()
    expect(group!.status).toBe('composing')
    expect(group!.task_order).toEqual([])
    expect(group!.pr_number).toBeNull()
    expect(group!.pr_url).toBeNull()
    expect(group!.created_at).toBeTruthy()
    expect(group!.updated_at).toBeTruthy()
  })

  it('stores an optional description', () => {
    const group = createPrGroup(
      { repo: 'fleet', title: 'With Description', branchName: 'pr/with-desc', description: 'my desc' },
      db
    )

    expect(group!.description).toBe('my desc')
  })

  it('assigns a unique ID per group', () => {
    const a = createPrGroup({ repo: 'fleet', title: 'A', branchName: 'pr/a' }, db)
    const b = createPrGroup({ repo: 'fleet', title: 'B', branchName: 'pr/b' }, db)

    expect(a!.id).not.toBe(b!.id)
  })
})

describe('getPrGroup', () => {
  it('retrieves a group by ID', () => {
    const created = createPrGroup({ repo: 'fleet', title: 'Fetch Me', branchName: 'pr/fetch' }, db)
    const fetched = getPrGroup(created!.id, db)

    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created!.id)
    expect(fetched!.title).toBe('Fetch Me')
  })

  it('returns null for a non-existent ID', () => {
    expect(getPrGroup('does-not-exist', db)).toBeNull()
  })
})

describe('listPrGroups', () => {
  it('returns all groups when no repo filter is given', () => {
    createPrGroup({ repo: 'fleet', title: 'A', branchName: 'pr/a' }, db)
    createPrGroup({ repo: 'other', title: 'B', branchName: 'pr/b' }, db)

    const groups = listPrGroups(undefined, db)
    expect(groups).toHaveLength(2)
  })

  it('filters groups by repo', () => {
    createPrGroup({ repo: 'fleet', title: 'Fleet PR', branchName: 'pr/fleet' }, db)
    createPrGroup({ repo: 'other', title: 'Other PR', branchName: 'pr/other' }, db)

    const fleetGroups = listPrGroups('fleet', db)
    expect(fleetGroups).toHaveLength(1)
    expect(fleetGroups[0].repo).toBe('fleet')
  })

  it('returns an empty array when no groups exist', () => {
    expect(listPrGroups(undefined, db)).toEqual([])
  })

  it('orders groups by created_at descending (newer rows first)', () => {
    // Insert two groups with distinct timestamps to verify descending order
    const ts1 = '2024-01-01T00:00:00.000Z'
    const ts2 = '2024-01-02T00:00:00.000Z'

    db.prepare(
      `INSERT INTO pr_groups (id, repo, title, branch_name, status, task_order, created_at, updated_at)
       VALUES ('aaa', 'fleet', 'Older', 'pr/older', 'composing', '[]', ?, ?)`
    ).run(ts1, ts1)
    db.prepare(
      `INSERT INTO pr_groups (id, repo, title, branch_name, status, task_order, created_at, updated_at)
       VALUES ('bbb', 'fleet', 'Newer', 'pr/newer', 'composing', '[]', ?, ?)`
    ).run(ts2, ts2)

    const groups = listPrGroups('fleet', db)
    expect(groups[0].title).toBe('Newer')
    expect(groups[1].title).toBe('Older')
  })
})

describe('updatePrGroup', () => {
  it('updates the title', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'Old Title', branchName: 'pr/old' }, db)
    const updated = updatePrGroup(group!.id, { title: 'New Title' }, db)

    expect(updated!.title).toBe('New Title')
  })

  it('updates the branch name', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/old-branch' }, db)
    const updated = updatePrGroup(group!.id, { branchName: 'pr/new-branch' }, db)

    expect(updated!.branch_name).toBe('pr/new-branch')
  })

  it('updates the status', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    const updated = updatePrGroup(group!.id, { status: 'building' }, db)

    expect(updated!.status).toBe('building')
  })

  it('updates pr_number and pr_url', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    const updated = updatePrGroup(
      group!.id,
      { prNumber: 42, prUrl: 'https://github.com/org/repo/pull/42' },
      db
    )

    expect(updated!.pr_number).toBe(42)
    expect(updated!.pr_url).toBe('https://github.com/org/repo/pull/42')
  })

  it('clears nullable fields when set to null', () => {
    const group = createPrGroup(
      { repo: 'fleet', title: 'T', branchName: 'pr/t', description: 'desc' },
      db
    )
    const updated = updatePrGroup(group!.id, { description: null, prNumber: null, prUrl: null }, db)

    expect(updated!.description).toBeNull()
    expect(updated!.pr_number).toBeNull()
    expect(updated!.pr_url).toBeNull()
  })

  it('leaves unspecified fields untouched', () => {
    const group = createPrGroup(
      { repo: 'fleet', title: 'Stable Title', branchName: 'pr/t', description: 'keep me' },
      db
    )
    updatePrGroup(group!.id, { status: 'open' }, db)
    const fetched = getPrGroup(group!.id, db)

    expect(fetched!.title).toBe('Stable Title')
    expect(fetched!.description).toBe('keep me')
  })

  it('returns null for a non-existent ID', () => {
    expect(updatePrGroup('no-such-id', { title: 'X' }, db)).toBeNull()
  })
})

describe('addTaskToGroup', () => {
  it('appends a task ID to task_order', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    const updated = addTaskToGroup(group!.id, 'task-abc', db)

    expect(updated!.task_order).toEqual(['task-abc'])
  })

  it('does not add the same task ID twice', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    addTaskToGroup(group!.id, 'task-abc', db)
    const updated = addTaskToGroup(group!.id, 'task-abc', db)

    expect(updated!.task_order).toEqual(['task-abc'])
  })

  it('appends multiple tasks in order', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    addTaskToGroup(group!.id, 'task-1', db)
    const updated = addTaskToGroup(group!.id, 'task-2', db)

    expect(updated!.task_order).toEqual(['task-1', 'task-2'])
  })

  it('returns null for a non-existent group', () => {
    expect(addTaskToGroup('ghost-group', 'task-1', db)).toBeNull()
  })
})

describe('removeTaskFromGroup', () => {
  it('removes a task ID from task_order', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    addTaskToGroup(group!.id, 'task-1', db)
    addTaskToGroup(group!.id, 'task-2', db)
    const updated = removeTaskFromGroup(group!.id, 'task-1', db)

    expect(updated!.task_order).toEqual(['task-2'])
  })

  it('is a no-op when task ID is not present', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    addTaskToGroup(group!.id, 'task-1', db)
    const updated = removeTaskFromGroup(group!.id, 'task-not-here', db)

    expect(updated!.task_order).toEqual(['task-1'])
  })

  it('returns null for a non-existent group', () => {
    expect(removeTaskFromGroup('ghost-group', 'task-1', db)).toBeNull()
  })
})

describe('deletePrGroup', () => {
  it('removes the group and returns true', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'Delete Me', branchName: 'pr/del' }, db)
    const deleted = deletePrGroup(group!.id, db)

    expect(deleted).toBe(true)
    expect(getPrGroup(group!.id, db)).toBeNull()
  })

  it('returns false for a non-existent ID', () => {
    expect(deletePrGroup('no-such-id', db)).toBe(false)
  })
})

describe('rowToGroup — JSON sanitization', () => {
  it('filters out non-string entries from task_order', () => {
    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)

    // Inject a malformed task_order with mixed types
    db.prepare('UPDATE pr_groups SET task_order = ? WHERE id = ?').run(
      JSON.stringify(['valid-id', 42, null, true]),
      group!.id
    )

    const fetched = getPrGroup(group!.id, db)
    expect(fetched!.task_order).toEqual(['valid-id'])
  })

  it('defaults task_order to [] on malformed JSON', () => {
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    setPrGroupQueriesLogger(mockLogger)

    const group = createPrGroup({ repo: 'fleet', title: 'T', branchName: 'pr/t' }, db)
    db.prepare('UPDATE pr_groups SET task_order = ? WHERE id = ?').run('not-valid-json{', group!.id)

    const fetched = getPrGroup(group!.id, db)
    expect(fetched!.task_order).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Malformed task_order JSON')
    )

    // Restore default logger
    setPrGroupQueriesLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  })
})
