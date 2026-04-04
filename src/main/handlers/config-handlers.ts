import { safeHandle } from '../ipc-utils'
import { getSetting, setSetting, getSettingJson, setSettingJson, deleteSetting } from '../settings'
import {
  saveProfile,
  loadProfile,
  applyProfile,
  listProfiles,
  deleteProfile
} from '../services/settings-profiles'

export function registerConfigHandlers(): void {
  // Settings CRUD
  safeHandle('settings:get', (_e, key: string) => getSetting(key))
  safeHandle('settings:set', (_e, key: string, value: string) => setSetting(key, value))
  safeHandle('settings:getJson', (_e, key: string) => getSettingJson(key))
  safeHandle('settings:setJson', (_e, key: string, value: unknown) => setSettingJson(key, value))
  safeHandle('settings:delete', (_e, key: string) => deleteSetting(key))

  // Settings profiles
  safeHandle('settings:saveProfile', (_e, name: string) => saveProfile(name))
  safeHandle('settings:loadProfile', (_e, name: string) => loadProfile(name))
  safeHandle('settings:applyProfile', (_e, name: string) => applyProfile(name))
  safeHandle('settings:listProfiles', () => listProfiles())
  safeHandle('settings:deleteProfile', (_e, name: string) => deleteProfile(name))
}
