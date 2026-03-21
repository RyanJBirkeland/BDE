import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// Use in-memory DB for tests
let db: Database.Database

vi.mock('../db', () => ({
  getDb: () => db,
}))

import {
  getSetting,
  setSetting,
  deleteSetting,
  getSettingJson,
  setSettingJson,
} from '../settings'

describe('settings.ts', () => {
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `)
    vi.clearAllMocks()
  })

  afterEach(() => {
    db.close()
  })

  describe('CRUD operations', () => {
    it('getSetting returns null for non-existent key', () => {
      expect(getSetting('nonexistent')).toBeNull()
    })

    it('setSetting stores a value and getSetting retrieves it', () => {
      setSetting('test.key', 'hello')
      expect(getSetting('test.key')).toBe('hello')
    })

    it('setSetting upserts on conflict', () => {
      setSetting('test.key', 'first')
      setSetting('test.key', 'second')
      expect(getSetting('test.key')).toBe('second')
    })

    it('deleteSetting removes a key', () => {
      setSetting('test.key', 'value')
      deleteSetting('test.key')
      expect(getSetting('test.key')).toBeNull()
    })

    it('deleteSetting is a no-op for non-existent key', () => {
      expect(() => deleteSetting('nonexistent')).not.toThrow()
    })
  })

  describe('JSON get/set', () => {
    it('setSettingJson stores JSON and getSettingJson retrieves it', () => {
      const data = { name: 'BDE', path: '/tmp' }
      setSettingJson('repos', data)
      expect(getSettingJson('repos')).toEqual(data)
    })

    it('getSettingJson returns null for non-existent key', () => {
      expect(getSettingJson('nonexistent')).toBeNull()
    })

    it('getSettingJson returns null for invalid JSON', () => {
      setSetting('bad.json', '{not valid json')
      expect(getSettingJson('bad.json')).toBeNull()
    })

    it('handles arrays', () => {
      const repos = [
        { name: 'BDE', localPath: '/tmp/bde' },
        { name: 'life-os', localPath: '/tmp/life-os' },
      ]
      setSettingJson('repos', repos)
      expect(getSettingJson('repos')).toEqual(repos)
    })
  })
})
