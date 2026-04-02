import { safeHandle } from '../ipc-utils'
import { getSetting, setSetting, getSettingJson, setSettingJson, deleteSetting } from '../settings'

export function registerConfigHandlers(): void {
  // Settings CRUD
  safeHandle('settings:get', (_e, key: string) => getSetting(key))
  safeHandle('settings:set', (_e, key: string, value: string) => setSetting(key, value))
  safeHandle('settings:getJson', (_e, key: string) => getSettingJson(key))
  safeHandle('settings:setJson', (_e, key: string, value: unknown) => setSettingJson(key, value))
  safeHandle('settings:delete', (_e, key: string) => deleteSetting(key))
}
