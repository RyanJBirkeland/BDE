/**
 * v037 heals databases that are missing the webhooks table because some users
 * upgraded past v026 before the table was created. It is a no-op on correctly
 * migrated DBs and a CREATE IF NOT EXISTS heal on drifted ones.
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version, description } from '../v037-heal-dbs-missing-the-webhooks-table-some-users-upg'
import { makeMigrationTestDb, tableExists } from './helpers'

describe('migration v037', () => {
  it('has version 37 and a meaningful description', () => {
    expect(version).toBe(37)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates the webhooks table on a drifted DB that skipped v026', () => {
    // Simulate a drifted DB: v037 prerequisites minus v026 (webhooks never created)
    const db = makeMigrationTestDb(36)
    // Drop webhooks to simulate a drifted DB
    db.exec('DROP TABLE IF EXISTS webhooks')
    expect(tableExists(db, 'webhooks')).toBe(false)

    up(db)

    expect(tableExists(db, 'webhooks')).toBe(true)
    db.close()
  })

  it('is a no-op on a correctly migrated DB where webhooks already exists', () => {
    const db = makeMigrationTestDb(36)
    expect(tableExists(db, 'webhooks')).toBe(true)

    // Pre-existing webhook row should survive
    db.prepare(
      `INSERT INTO webhooks (id, url, events, enabled)
       VALUES ('existing-hook', 'https://pre-existing.example.com/hook', '[]', 1)`
    ).run()

    up(db)

    const row = db.prepare('SELECT url FROM webhooks WHERE id = ?').get('existing-hook') as
      | { url: string }
      | undefined
    expect(row?.url).toBe('https://pre-existing.example.com/hook')
    db.close()
  })

  it('is idempotent — applying twice does not throw or corrupt data', () => {
    const db = makeMigrationTestDb(36)
    db.exec('DROP TABLE IF EXISTS webhooks')

    up(db)
    up(db)

    expect(tableExists(db, 'webhooks')).toBe(true)
    db.close()
  })

  it('creates the webhooks_updated_at trigger', () => {
    const db = new Database(':memory:')
    up(db)

    const trigger = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='webhooks_updated_at'`)
      .get() as { name: string } | undefined
    expect(trigger?.name).toBe('webhooks_updated_at')
    db.close()
  })
})
