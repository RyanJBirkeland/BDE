import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations, migrations } from '../db'

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

  it('creates all expected tables', () => {
    runMigrations(db)

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()

    expect(tables).toEqual(['agent_runs', 'cost_events', 'settings', 'sprint_tasks'])
  })

  it('creates expected indexes', () => {
    runMigrations(db)

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all() as {
        name: string
      }[]
    )
      .map((i) => i.name)
      .sort()

    expect(indexes).toEqual([
      'idx_agent_runs_finished',
      'idx_agent_runs_pid',
      'idx_agent_runs_status',
      'idx_sprint_tasks_status'
    ])
  })

  it('creates sprint_tasks table with CHECK constraint and trigger', () => {
    runMigrations(db)

    // Verify table exists
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sprint_tasks'")
      .get() as { name: string } | undefined
    expect(table?.name).toBe('sprint_tasks')

    // Verify CHECK constraint rejects invalid status
    expect(() => {
      db.prepare(
        "INSERT INTO sprint_tasks (title, status) VALUES ('bad', 'invalid')"
      ).run()
    }).toThrow()

    // Verify trigger updates updated_at on UPDATE
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, status) VALUES ('t1', 'Test', 'backlog')"
    ).run()
    const beforeRow = db
      .prepare('SELECT updated_at FROM sprint_tasks WHERE id = ?')
      .get('t1') as { updated_at: string }
    expect(beforeRow.updated_at).toBeTruthy()

    // Force a different created_at so the trigger's updated_at is distinguishable
    db.prepare(
      "UPDATE sprint_tasks SET title = 'tmp', created_at = '2000-01-01T00:00:00.000Z' WHERE id = 't1'"
    ).run()
    // Now update again — the trigger should set updated_at to 'now', not '2000-...'
    db.prepare("UPDATE sprint_tasks SET title = 'Updated' WHERE id = 't1'").run()
    const afterRow = db
      .prepare('SELECT updated_at, created_at FROM sprint_tasks WHERE id = ?')
      .get('t1') as { updated_at: string; created_at: string }

    // Trigger fires: updated_at should be a current timestamp, not the old created_at
    expect(afterRow.updated_at).toBeTruthy()
    expect(afterRow.created_at).toBe('2000-01-01T00:00:00.000Z')
    expect(afterRow.updated_at).not.toBe('2000-01-01T00:00:00.000Z')
  })

  it('adds cost columns to agent_runs', () => {
    runMigrations(db)

    const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
    for (const col of ['cost_usd', 'tokens_in', 'tokens_out', 'cache_read', 'cache_create', 'duration_ms', 'num_turns']) {
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

    // Verify cost_events table does not exist yet
    const before = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cost_events'")
      .get()
    expect(before).toBeUndefined()

    // Now run the migration system — should only run 3+
    runMigrations(db2)

    const version = db2.pragma('user_version', { simple: true }) as number
    expect(version).toBe(migrations[migrations.length - 1].version)

    // cost_events should now exist (migration 4)
    const after = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cost_events'")
      .get() as { name: string } | undefined
    expect(after?.name).toBe('cost_events')

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
})
