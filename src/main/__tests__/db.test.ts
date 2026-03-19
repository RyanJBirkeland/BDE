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

    expect(tables).toEqual(['agent_runs', 'cost_events', 'settings'])
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
      'idx_agent_runs_status'
    ])
  })

  // sprint_tasks_updated_at trigger and pr_mergeable_state tests removed —
  // sprint_tasks is now owned by bde-task-runner service (E0 extraction)

  it('adds cost columns to agent_runs', () => {
    runMigrations(db)

    const cols = (db.pragma('table_info(agent_runs)') as { name: string }[]).map((c) => c.name)
    for (const col of ['cost_usd', 'tokens_in', 'tokens_out', 'cache_read', 'cache_create', 'duration_ms', 'num_turns']) {
      expect(cols).toContain(col)
    }
  })

  // sprint_tasks CHECK constraint test removed — owned by bde-task-runner

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
