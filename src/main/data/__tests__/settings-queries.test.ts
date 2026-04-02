import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import {
  getSetting,
  setSetting,
  deleteSetting,
  getSettingJson,
  setSettingJson
} from '../settings-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('getSetting / setSetting', () => {
  it('returns null for non-existent key', () => {
    expect(getSetting(db, 'nonexistent')).toBeNull()
  })

  it('stores and retrieves a value', () => {
    setSetting(db, 'test.key', 'hello')
    expect(getSetting(db, 'test.key')).toBe('hello')
  })

  it('overwrites existing value', () => {
    setSetting(db, 'test.key', 'first')
    setSetting(db, 'test.key', 'second')
    expect(getSetting(db, 'test.key')).toBe('second')
  })
})

describe('deleteSetting', () => {
  it('removes an existing setting', () => {
    setSetting(db, 'to.delete', 'value')
    expect(getSetting(db, 'to.delete')).toBe('value')
    deleteSetting(db, 'to.delete')
    expect(getSetting(db, 'to.delete')).toBeNull()
  })

  it('does nothing for non-existent key', () => {
    expect(() => deleteSetting(db, 'nonexistent')).not.toThrow()
  })
})

describe('getSettingJson / setSettingJson', () => {
  it('round-trips a JSON object', () => {
    const data = { name: 'test', count: 42, nested: { ok: true } }
    setSettingJson(db, 'json.key', data)
    const result = getSettingJson<typeof data>(db, 'json.key')
    expect(result).toEqual(data)
  })

  it('round-trips a JSON array', () => {
    const data = [1, 2, 3]
    setSettingJson(db, 'arr.key', data)
    expect(getSettingJson<number[]>(db, 'arr.key')).toEqual([1, 2, 3])
  })

  it('returns null for non-existent key', () => {
    expect(getSettingJson(db, 'nonexistent')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    setSetting(db, 'bad.json', 'not json {{{')
    expect(getSettingJson(db, 'bad.json')).toBeNull()
  })
})
