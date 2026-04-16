import { typedInvoke } from './ipc-helpers'

export const settings = {
  get: (key: string) => typedInvoke('settings:get', key),
  hasSecret: (key: string) => typedInvoke('settings:hasSecret', key),
  set: (key: string, value: string) => typedInvoke('settings:set', key, value),
  getJson: (key: string) => typedInvoke('settings:getJson', key),
  setJson: (key: string, value: unknown) => typedInvoke('settings:setJson', key, value),
  delete: (key: string) => typedInvoke('settings:delete', key),
  saveProfile: (name: string) => typedInvoke('settings:saveProfile', name),
  loadProfile: (name: string) => typedInvoke('settings:loadProfile', name),
  applyProfile: (name: string) => typedInvoke('settings:applyProfile', name),
  listProfiles: () => typedInvoke('settings:listProfiles'),
  deleteProfile: (name: string) => typedInvoke('settings:deleteProfile', name),
  getEncryptionStatus: () => typedInvoke('settings:getEncryptionStatus')
}

export const claudeConfig = {
  get: () => typedInvoke('claude:getConfig'),
  setPermissions: (permissions: { allow: string[]; deny: string[] }) =>
    typedInvoke('claude:setPermissions', permissions)
}
