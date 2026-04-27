/**
 * v026 creates the webhooks table for external event notifications.
 */
import { describe, it, expect } from 'vitest'
import { up, version, description } from '../v026-create-webhooks-table-for-external-event-notificat'
import { makeMigrationTestDb, tableExists, listTableColumns } from './helpers'

describe('migration v026', () => {
  it('has version 26 and a meaningful description', () => {
    expect(version).toBe(26)
    expect(description.length).toBeGreaterThan(10)
  })

  it('creates the webhooks table', () => {
    const db = makeMigrationTestDb(25)
    expect(tableExists(db, 'webhooks')).toBe(false)

    up(db)

    expect(tableExists(db, 'webhooks')).toBe(true)
    db.close()
  })

  it('creates the expected columns on the webhooks table', () => {
    const db = makeMigrationTestDb(25)
    up(db)

    const columns = listTableColumns(db, 'webhooks')
    expect(columns).toContain('id')
    expect(columns).toContain('url')
    expect(columns).toContain('events')
    expect(columns).toContain('secret')
    expect(columns).toContain('enabled')
    expect(columns).toContain('created_at')
    expect(columns).toContain('updated_at')
    db.close()
  })

  it('inserts a webhook row and auto-generates id and timestamps', () => {
    const db = makeMigrationTestDb(25)
    up(db)

    db.prepare(
      `INSERT INTO webhooks (url, events, enabled) VALUES ('https://example.com/hook', '["task.done"]', 1)`
    ).run()

    const row = db.prepare('SELECT * FROM webhooks').get() as {
      id: string; url: string; events: string; enabled: number; created_at: string
    }
    expect(row.id).not.toBeNull()
    expect(row.url).toBe('https://example.com/hook')
    expect(row.events).toBe('["task.done"]')
    expect(row.enabled).toBe(1)
    expect(row.created_at).not.toBeNull()
    db.close()
  })

  it('is idempotent (IF NOT EXISTS) when webhooks table already exists', () => {
    const db = makeMigrationTestDb(25)
    up(db)
    expect(() => up(db)).not.toThrow()
    db.close()
  })
})
