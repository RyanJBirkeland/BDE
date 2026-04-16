/**
 * Settings and configuration IPC channels.
 */

/** Settings CRUD */
export interface SettingsChannels {
  'settings:get': {
    args: [key: string]
    result: string | null
  }
  'settings:set': {
    args: [key: string, value: string]
    result: void
  }
  'settings:getJson': {
    args: [key: string]
    result: unknown
  }
  'settings:setJson': {
    args: [key: string, value: unknown]
    result: void
  }
  'settings:delete': {
    args: [key: string]
    result: void
  }
  'settings:hasSecret': {
    args: [key: string]
    result: boolean
  }
  'settings:saveProfile': {
    args: [name: string]
    result: void
  }
  'settings:loadProfile': {
    args: [name: string]
    result: Record<string, string | null> | null
  }
  'settings:applyProfile': {
    args: [name: string]
    result: boolean
  }
  'settings:listProfiles': {
    args: []
    result: string[]
  }
  'settings:deleteProfile': {
    args: [name: string]
    result: void
  }
  'settings:getEncryptionStatus': {
    args: []
    result: { available: boolean; reason?: string }
  }
}

/** Claude Config */
export interface ClaudeConfigChannels {
  'claude:getConfig': {
    args: []
    result: { permissions?: { allow?: string[]; deny?: string[] }; [key: string]: unknown }
  }
  'claude:setPermissions': {
    args: [{ allow: string[]; deny: string[] }]
    result: void
  }
}

/** Auth status */
export interface AuthChannels {
  'auth:status': {
    args: []
    result: { cliFound: boolean; tokenFound: boolean; tokenExpired: boolean; expiresAt?: string }
  }
}

/** Onboarding prerequisite checks */
export interface OnboardingChannels {
  'onboarding:checkGhCli': {
    args: []
    result: { available: boolean; version?: string }
  }
}
