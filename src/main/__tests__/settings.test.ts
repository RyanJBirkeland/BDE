import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// Use in-memory DB for tests
let db: Database.Database

const { mockEncryptString, mockDecryptString } = vi.hoisted(() => ({
  mockEncryptString: vi.fn((v: string) => Buffer.from(v + '_enc')),
  mockDecryptString: vi.fn((buf: Buffer) => buf.toString().replace('_enc', ''))
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: mockEncryptString,
    decryptString: mockDecryptString
  }
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

vi.mock('../db', () => ({
  getDb: () => db
}))

import { getSetting, setSetting, deleteSetting, getSettingJson, setSettingJson } from '../settings'

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
        { name: 'life-os', localPath: '/tmp/life-os' }
      ]
      setSettingJson('repos', repos)
      expect(getSettingJson('repos')).toEqual(repos)
    })
  })

  describe('sensitive key encryption', () => {
    it('setSetting encrypts github.token before storage', () => {
      setSetting('github.token', 'ghp_abc123')
      const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get('github.token') as
        | { value: string }
        | undefined
      expect(raw?.value.startsWith('ENC:')).toBe(true)
    })

    it('getSetting decrypts github.token on read', () => {
      setSetting('github.token', 'ghp_secrettoken')
      const result = getSetting('github.token')
      expect(result).toBe('ghp_secrettoken')
    })

    it('non-sensitive keys are stored and returned as plaintext', () => {
      setSetting('agent.eventRetentionDays', '30')
      const raw = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('agent.eventRetentionDays') as { value: string } | undefined
      expect(raw?.value).toBe('30')
      expect(getSetting('agent.eventRetentionDays')).toBe('30')
    })

    it('getSetting lazy-migrates plaintext sensitive values to encrypted', () => {
      // Simulate legacy plaintext stored directly in DB (bypassing setSetting)
      db.prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('github.token', 'ghp_legacy_plaintext', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run()

      // First read triggers migration
      const result = getSetting('github.token')
      expect(result).toBe('ghp_legacy_plaintext')

      // Value should now be encrypted in DB
      const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get('github.token') as
        | { value: string }
        | undefined
      expect(raw?.value.startsWith('ENC:')).toBe(true)
    })
  })
})
