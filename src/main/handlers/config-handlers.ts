import { safeHandle } from '../ipc-utils'
import { getGatewayConfig } from '../config'
import { getSetting, setSetting, getSettingJson, setSettingJson, deleteSetting } from '../settings'

export function registerConfigHandlers(): void {
  safeHandle('config:getGatewayUrl', () => {
    const config = getGatewayConfig()
    return { url: config?.url ?? '', hasToken: !!config?.token }
  })
  safeHandle('config:saveGateway', (_e, url: string, token?: string) => {
    setSetting('gateway.url', url)
    if (token) {
      setSetting('gateway.token', token)
    }
  })

  // Settings CRUD
  safeHandle('settings:get', (_e, key: string) => getSetting(key))
  safeHandle('settings:set', (_e, key: string, value: string) => setSetting(key, value))
  safeHandle('settings:getJson', (_e, key: string) => getSettingJson(key))
  safeHandle('settings:setJson', (_e, key: string, value: unknown) => setSettingJson(key, value))
  safeHandle('settings:delete', (_e, key: string) => deleteSetting(key))
}
