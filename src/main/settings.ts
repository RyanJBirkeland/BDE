import type Database from 'better-sqlite3'
import { getDb } from './db'
import {
  getSetting as _getSetting,
  setSetting as _setSetting,
  deleteSetting as _deleteSetting,
  getSettingJson as _getSettingJson,
  setSettingJson as _setSettingJson
} from './data/settings-queries'

export function getSetting(key: string, db?: Database.Database): string | null {
  return _getSetting(db ?? getDb(), key)
}

export function setSetting(key: string, value: string, db?: Database.Database): void {
  _setSetting(db ?? getDb(), key, value)
}

export function deleteSetting(key: string, db?: Database.Database): void {
  _deleteSetting(db ?? getDb(), key)
}

export function getSettingJson<T>(key: string, db?: Database.Database): T | null {
  return _getSettingJson<T>(db ?? getDb(), key)
}

export function setSettingJson<T>(key: string, value: T, db?: Database.Database): void {
  _setSettingJson<T>(db ?? getDb(), key, value)
}

// Well-known setting keys
export const SETTING_SUPABASE_URL = 'supabase.url'
export const SETTING_SUPABASE_KEY = 'supabase.serviceKey'
export const SETTING_DEPENDENCY_CASCADE_BEHAVIOR = 'dependency.cascadeBehavior'
