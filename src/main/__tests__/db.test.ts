import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runMigrations, migrations } from '../db'

// Use a fixed (non-pid) temp path for the vi.mock factory, which is hoisted before variable init
const BACKUP_TEST_DIR = join(tmpdir(), 'bde-db-backup-test')
const BACKUP_TEST_DB_PATH = join(tmpdir(), 'bde-db-backup-test', 'bde.db')

vi.mock('../paths', async (importOriginal) => {
  const { join: pathJoin } = await import('path')
  const { tmpdir: osTmpdir } = await import('os')
  const original = await importOriginal<typeof import('../paths')>()
  const testDir = pathJoin(osTmpdir(), 'bde-db-backup-test')
  return {
    ...original,
    BDE_DIR: testDir,
    BDE_DB_PATH: pathJoin(testDir, 'bde.db')
  }
})

describe('db schema migrations', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  })

  afterEach(() => {
    db.close()
  })

  it('fresh DB runs all migrations and sets user_version to latest', () => {
    runMigrations(db)

    const version = db.pragma('user_version', { simple: true }) as number
    const latest = migrations[migrations.length - 1].version
    expect(version).toBe(latest)
  })

  it('heals drifted DB at v35 that is missing the webhooks table (v37 heal)', () => {
    // Reproduce the drift: run all migrations EXCEPT v26 (which creates
    // webhooks), then bump user_version to 35 so the runner thinks it's
    // up-to-date and only runs v36/v37. This matches the real-world case
    // where some users' DBs skipped v26 during a botched upgrade path.
    for (const m of migrations.filter((mig) => mig.version <= 35 && mig.version !== 26)) {
      m.up(db)
    }
    db.pragma('user_version = 35')

    // Confirm the drift: webhooks table does NOT exist
    const beforeRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhooks'")
      .get()
    expect(beforeRow).toBeUndefined()

    // Run migrations — v36 (indexes) and v37 (heal) should execute
    runMigrations(db)

    // After healing, the webhooks table must exist
    const afterRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhooks'")
      .get()
    expect(afterRow).toEqual({ name: 'webhooks' })

    // And version should be latest
    const version = db.pragma('user_version', { simple: true }) as number
    expect(version).toBe(migrations[migrations.length - 1].version)
  })

  it('v37 heal is idempotent on a fresh DB that already has webhooks', () => {
    // Fresh DB — v26 created the webhooks table, v37 must not error
    runMigrations(db)
    // Run migrations a second time (should be a no-op)
    expect(() => runMigrations(db)).not.toThrow()
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhooks'")
      .get()
    expect(row).toEqual({ name: 'webhooks' })
  })

  it('creates all expected tables', () => {
    runMigrations(db)

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()

    expect(tables).toEqual([
      'agent_events',
      'agent_runs',
      'review_comments',
      'settings',
      'sprint_tasks',
      'sprints',
      'task_changes',
      'task_groups',
      'webhooks'
    ])
  })

  it('creates expected indexes', () => {
    runMigrations(db)

    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as {
        name: string
      }[]
    )
      .map((i) => i.name)
      .sort()

    expect(indexes).toEqual([
      'idx_agent_events_agent',
      'idx_agent_runs_finished',
      'idx_agent_runs_pid',
      'idx_agent_runs_sprint_task',
      'idx_agent_runs_status',
      'idx_review_comments_task_id',
      'idx_sprint_tasks_claimed_by',
      'idx_sprint_tasks_group',
      'idx_sprint_tasks_pr_number',
      'idx_sprint_tasks_pr_open',
      'idx_sprint_tasks_sprint',
      'idx_sprint_tasks_status',
      'idx_sprint_tasks_status_claimed',
      'idx_task_changes_changed_at',
      'idx_task_changes_task_changed',
      'idx_task_changes_task_id'
    ])
  })

  it('adds cost columns to agent_runs', () => {
    runMigrations(db)

    const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
    for (const col of [
      'cost_usd',
      'tokens_in',
      'tokens_out',
      'cache_read',
      'cache_create',
      'duration_ms',
      'num_turns'
    ]) {
      expect(cols).toContain(col)
    }
  })

  it('DB at version 2 only runs migrations 3+', () => {
    // Run migrations up to version 2
    runMigrations(db)
    // Reset to version 2 to simulate a DB that stopped there
    db.pragma('user_version = 2')

    // Verify no cost columns yet would be the real scenario, but since we
    // already ran all migrations, let's use a fresh DB instead
    const db2 = new Database(':memory:')
    db2.pragma('journal_mode = WAL')
    db2.pragma('foreign_keys = ON')

    // Manually run only migrations 1 and 2
    for (const m of migrations.filter((m) => m.version <= 2)) {
      m.up(db2)
    }
    db2.pragma('user_version = 2')

    // Verify cost columns on agent_runs do not exist yet (added by v3)
    const beforeCols = (db2.pragma('table_info(agent_runs)') as { name: string }[]).map(
      (c) => c.name
    )
    expect(beforeCols).not.toContain('cost_usd')

    // Now run the migration system — should only run 3+
    runMigrations(db2)

    const version = db2.pragma('user_version', { simple: true }) as number
    expect(version).toBe(migrations[migrations.length - 1].version)

    // cost_usd should now exist (migration v3)
    const afterCols = (db2.pragma('table_info(agent_runs)') as { name: string }[]).map(
      (c) => c.name
    )
    expect(afterCols).toContain('cost_usd')

    // cost_events should NOT exist (created in v4, dropped in v42)
    const costEventsTable = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cost_events'")
      .get()
    expect(costEventsTable).toBeUndefined()

    db2.close()
  })

  it('is idempotent — running twice does not error', () => {
    runMigrations(db)
    runMigrations(db)

    const version = db.pragma('user_version', { simple: true }) as number
    expect(version).toBe(migrations[migrations.length - 1].version)
  })

  it('skips all migrations when already at latest version', () => {
    runMigrations(db)

    const versionBefore = db.pragma('user_version', { simple: true }) as number

    // Running again should be a no-op
    runMigrations(db)

    const versionAfter = db.pragma('user_version', { simple: true }) as number
    expect(versionAfter).toBe(versionBefore)
  })

  it('migrations are sorted by ascending version', () => {
    const versions = migrations.map((m) => m.version)
    const sorted = [...versions].sort((a, b) => a - b)
    expect(versions).toEqual(sorted)
  })

  it('migration versions are unique', () => {
    const versions = migrations.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('migration v13 adds sprint_task_id column to agent_runs', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('sprint_task_id')
    db.close()
  })

  it('migration v38 normalizes sprint_tasks.repo to lowercase', () => {
    const db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Run migrations up to v37
    for (const m of migrations.filter((mig) => mig.version <= 37)) {
      m.up(db)
    }
    db.pragma('user_version = 37')

    // Insert a task with uppercase repo
    db.prepare(
      `INSERT INTO sprint_tasks (id, title, repo, status) VALUES (?, ?, ?, ?)`
    ).run('test-task-1', 'Test Task', 'BDE', 'backlog')

    // Verify the repo is uppercase before migration
    const before = db.prepare('SELECT repo FROM sprint_tasks WHERE id = ?').get('test-task-1') as {
      repo: string
    }
    expect(before.repo).toBe('BDE')

    // Run migration v38
    runMigrations(db)

    // Verify the repo is now lowercase
    const after = db.prepare('SELECT repo FROM sprint_tasks WHERE id = ?').get('test-task-1') as {
      repo: string
    }
    expect(after.repo).toBe('bde')

    db.close()
  })
})

describe('backupDatabase', () => {
  beforeEach(() => {
    mkdirSync(BACKUP_TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    const { closeDb } = await import('../db')
    closeDb()
    rmSync(BACKUP_TEST_DIR, { recursive: true, force: true })
  })

  it('creates a backup file at DB_PATH + .backup', async () => {
    const { backupDatabase } = await import('../db')
    backupDatabase()
    expect(existsSync(BACKUP_TEST_DB_PATH + '.backup')).toBe(true)
  })
})
