import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'

// Use in-memory DB for tests
let db: Database.Database

vi.mock('../db', () => ({
  getDb: () => db,
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
  }
})

import {
  getSetting,
  setSetting,
  deleteSetting,
  getSettingJson,
  setSettingJson,
  migrateFromOpenClawConfig,
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

  describe('migrateFromOpenClawConfig', () => {
    it('skips migration when gateway.url is already set', () => {
      setSetting('gateway.url', 'ws://existing')
      migrateFromOpenClawConfig()
      // readFileSync should not be called
      expect(vi.mocked(readFileSync)).not.toHaveBeenCalled()
    })

    it('skips migration when openclaw.json does not exist', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      migrateFromOpenClawConfig()
      expect(getSetting('gateway.url')).toBeNull()
    })

    it('imports gateway config from openclaw.json', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          gatewayUrl: 'ws://imported',
          gatewayToken: 'imported-token',
          githubToken: 'gh-tok',
        })
      )

      migrateFromOpenClawConfig()

      expect(getSetting('gateway.url')).toBe('ws://imported')
      expect(getSetting('gateway.token')).toBe('imported-token')
      expect(getSetting('github.token')).toBe('gh-tok')
    })

    it('imports default repos', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ gatewayUrl: 'ws://gw' })
      )

      migrateFromOpenClawConfig()

      const repos = getSettingJson<{ name: string }[]>('repos')
      expect(repos).toHaveLength(3)
      expect(repos![0].name).toBe('BDE')
      expect(repos![1].name).toBe('life-os')
      expect(repos![2].name).toBe('feast')
    })

    it('handles nested gateway.auth.token format', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          gateway: { auth: { token: 'nested-token' }, port: 9999 },
        })
      )

      migrateFromOpenClawConfig()

      expect(getSetting('gateway.token')).toBe('nested-token')
      expect(getSetting('gateway.url')).toBe('ws://127.0.0.1:9999')
    })

    it('imports task runner config', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          gatewayUrl: 'ws://gw',
          sprintApiKey: 'sprint-key',
          taskRunnerUrl: 'http://runner',
        })
      )

      migrateFromOpenClawConfig()

      expect(getSetting('taskRunner.apiKey')).toBe('sprint-key')
      expect(getSetting('taskRunner.url')).toBe('http://runner')
    })
  })
})
