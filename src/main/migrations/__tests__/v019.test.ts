import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  up,
  version,
  description
} from '../v019-remove-agentmanager-usenativesystem-setting-native'

const TARGET_KEY = 'agentManager.useNativeSystem'

function makeSettingsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
}

function insertSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

function selectSetting(db: Database.Database, key: string): { value: string } | undefined {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
}

describe('migration v019', () => {
  it('has version 19 and a meaningful description', () => {
    expect(version).toBe(19)
    expect(description).not.toMatch(/^Add\s*$/)
    expect(description.length).toBeGreaterThan(10)
  })

  it('deletes only the agentManager.useNativeSystem row and leaves unrelated settings intact', () => {
    const db = new Database(':memory:')
    makeSettingsTable(db)

    insertSetting(db, TARGET_KEY, 'true')
    insertSetting(db, 'github.token', 'ghp_unrelated_secret')
    insertSetting(db, 'agentManager.worktreeBase', '/Users/dev/worktrees/bde')
    insertSetting(db, 'agentManager.maxConcurrent', '2')
    insertSetting(db, 'theme', 'dark')

    up(db)

    expect(selectSetting(db, TARGET_KEY)).toBeUndefined()
    expect(selectSetting(db, 'github.token')?.value).toBe('ghp_unrelated_secret')
    expect(selectSetting(db, 'agentManager.worktreeBase')?.value).toBe('/Users/dev/worktrees/bde')
    expect(selectSetting(db, 'agentManager.maxConcurrent')?.value).toBe('2')
    expect(selectSetting(db, 'theme')?.value).toBe('dark')

    const remainingCount = (db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number })
      .n
    expect(remainingCount).toBe(4)

    db.close()
  })

  it('does not match keys that merely contain the target substring', () => {
    const db = new Database(':memory:')
    makeSettingsTable(db)

    insertSetting(db, 'agentManager.useNativeSystem.backup', 'keep-me')
    insertSetting(db, 'prefix.agentManager.useNativeSystem', 'also-keep-me')

    up(db)

    expect(selectSetting(db, 'agentManager.useNativeSystem.backup')?.value).toBe('keep-me')
    expect(selectSetting(db, 'prefix.agentManager.useNativeSystem')?.value).toBe('also-keep-me')
    db.close()
  })

  it('is a no-op success when the target row does not exist', () => {
    const db = new Database(':memory:')
    makeSettingsTable(db)

    insertSetting(db, 'github.token', 'ghp_unrelated_secret')
    insertSetting(db, 'agentManager.worktreeBase', '/Users/dev/worktrees/bde')
    insertSetting(db, 'agentManager.maxConcurrent', '2')
    insertSetting(db, 'theme', 'dark')

    expect(() => up(db)).not.toThrow()

    expect(selectSetting(db, 'github.token')?.value).toBe('ghp_unrelated_secret')
    expect(selectSetting(db, 'agentManager.worktreeBase')?.value).toBe('/Users/dev/worktrees/bde')
    expect(selectSetting(db, 'agentManager.maxConcurrent')?.value).toBe('2')
    expect(selectSetting(db, 'theme')?.value).toBe('dark')

    const remainingCount = (db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number })
      .n
    expect(remainingCount).toBe(4)

    db.close()
  })

  it('is idempotent (applying twice leaves the same state)', () => {
    const db = new Database(':memory:')
    makeSettingsTable(db)

    insertSetting(db, TARGET_KEY, 'false')
    insertSetting(db, 'github.token', 'ghp_unrelated_secret')

    up(db)
    up(db)

    expect(selectSetting(db, TARGET_KEY)).toBeUndefined()
    expect(selectSetting(db, 'github.token')?.value).toBe('ghp_unrelated_secret')
    db.close()
  })
})
