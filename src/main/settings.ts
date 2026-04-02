import { getDb } from './db'
import {
  getSetting as _getSetting,
  setSetting as _setSetting,
  deleteSetting as _deleteSetting,
  getSettingJson as _getSettingJson,
  setSettingJson as _setSettingJson
} from './data/settings-queries'

export function getSetting(key: string): string | null {
  return _getSetting(getDb(), key)
}

export function setSetting(key: string, value: string): void {
  _setSetting(getDb(), key, value)
}

export function deleteSetting(key: string): void {
  _deleteSetting(getDb(), key)
}

export function getSettingJson<T>(key: string): T | null {
  return _getSettingJson<T>(getDb(), key)
}

export function setSettingJson<T>(key: string, value: T): void {
  _setSettingJson<T>(getDb(), key, value)
}

// Well-known setting keys
export const SETTING_SUPABASE_URL = 'supabase.url'
export const SETTING_SUPABASE_KEY = 'supabase.serviceKey'

// Runner discovery — JSON array: [{ "name": "local", "url": "http://127.0.0.1:18799", "apiKey": "..." }]
export const SETTING_RUNNERS = 'runners'
