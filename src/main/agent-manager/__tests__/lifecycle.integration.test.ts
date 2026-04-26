import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Mocks — prevent file-system and IPC side-effects from the import chain.
// better-sqlite3, db.ts (runMigrations), and sprint-task-crud.ts are NOT
// mocked — exercising them against a real in-memory DB is the entire point.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

vi.mock('../../paths', () => ({
  BDE_DIR: '/tmp/bde-lifecycle-test',
  BDE_DB_PATH: '/tmp/bde-lifecycle-test/bde.db',
  BDE_TASK_MEMORY_DIR: '/tmp/bde-lifecycle-test/memory/tasks',
  getRepoPaths: vi.fn().mockReturnValue({}),
  getConfiguredRepos: vi.fn().mockReturnValue([])
}))

vi.mock('../../data/sprint-query-logger', () => ({
  getSprintQueriesLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn()
  })),
  setSprintQueriesLogger: vi.fn()
}))

// ---------------------------------------------------------------------------
// Imports — after mocks so the mocked modules are in place when imported
// ---------------------------------------------------------------------------

import { vi } from 'vitest'
import { runMigrations } from '../../db'
import { createTask, updateTask, getTask } from '../../data/sprint-task-crud'

describe('task lifecycle integration — real in-memory SQLite', () => {
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

  it('transitions a task through queued → active → review in the real data layer', async () => {
    const task = await createTask(
      {
        title: 'Lifecycle test',
        repo: 'bde',
        status: 'queued',
        priority: 0,
        playground_enabled: false
      },
      db
    )

    expect(task).not.toBeNull()
    expect(task!.status).toBe('queued')

    const active = await updateTask(
      task!.id,
      { status: 'active', claimed_by: 'executor' },
      undefined,
      db
    )

    expect(active).not.toBeNull()
    expect(active!.status).toBe('active')
    expect(active!.claimed_by).toBe('executor')

    const reviewed = await updateTask(
      task!.id,
      { status: 'review', claimed_by: null },
      undefined,
      db
    )

    expect(reviewed).not.toBeNull()
    expect(reviewed!.status).toBe('review')
    expect(reviewed!.claimed_by).toBeNull()

    const final = getTask(task!.id, db)

    expect(final).not.toBeNull()
    expect(final!.status).toBe('review')
    expect(final!.claimed_by).toBeNull()
  })
})
