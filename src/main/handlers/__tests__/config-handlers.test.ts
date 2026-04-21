/**
 * Config handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { homedir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn()
  }
}))

vi.mock('../../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getSettingJson: vi.fn(),
  setSettingJson: vi.fn(),
  deleteSetting: vi.fn()
}))

vi.mock('../../services/settings-profiles', () => ({
  saveProfile: vi.fn(),
  loadProfile: vi.fn(),
  applyProfile: vi.fn(),
  listProfiles: vi.fn(),
  deleteProfile: vi.fn()
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

vi.mock('../../secure-storage', () => ({
  SENSITIVE_SETTING_KEYS: new Set(['github.token', 'supabase.serviceKey'])
}))

import { registerConfigHandlers } from '../config-handlers'
import { safeHandle } from '../../ipc-utils'
import { safeStorage } from 'electron'
import {
  getSetting,
  setSetting,
  getSettingJson,
  setSettingJson,
  deleteSetting
} from '../../settings'
import {
  saveProfile,
  loadProfile,
  applyProfile,
  listProfiles,
  deleteProfile
} from '../../services/settings-profiles'

describe('Config handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 14 settings + mcp channels', () => {
    registerConfigHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(14)
    expect(safeHandle).toHaveBeenCalledWith('settings:get', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:hasSecret', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:set', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:getJson', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:setJson', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:delete', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:saveProfile', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:loadProfile', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:applyProfile', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:listProfiles', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:deleteProfile', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:getEncryptionStatus', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('mcp:getToken', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('mcp:regenerateToken', expect.any(Function))
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const handlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        handlers[channel] = handler
      })
      registerConfigHandlers()
      return handlers
    }

    const mockEvent = {} as IpcMainInvokeEvent

    it('settings:get calls getSetting with key', () => {
      vi.mocked(getSetting).mockReturnValue('myValue')
      const handlers = captureHandlers()

      const result = handlers['settings:get'](mockEvent, 'myKey')

      expect(getSetting).toHaveBeenCalledWith('myKey')
      expect(result).toBe('myValue')
    })

    it('settings:get returns null for sensitive keys without calling getSetting', () => {
      const handlers = captureHandlers()

      const result = handlers['settings:get'](mockEvent, 'github.token')

      expect(getSetting).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('settings:hasSecret returns false for non-sensitive keys', () => {
      const handlers = captureHandlers()

      const result = handlers['settings:hasSecret'](mockEvent, 'some.setting')

      expect(getSetting).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('settings:hasSecret returns true when a sensitive key has a value', () => {
      vi.mocked(getSetting).mockReturnValue('secret-value')
      const handlers = captureHandlers()

      const result = handlers['settings:hasSecret'](mockEvent, 'github.token')

      expect(getSetting).toHaveBeenCalledWith('github.token')
      expect(result).toBe(true)
    })

    it('settings:hasSecret returns false when a sensitive key has no value', () => {
      vi.mocked(getSetting).mockReturnValue(null)
      const handlers = captureHandlers()

      const result = handlers['settings:hasSecret'](mockEvent, 'github.token')

      expect(getSetting).toHaveBeenCalledWith('github.token')
      expect(result).toBe(false)
    })

    it('settings:set calls setSetting with key and value', () => {
      const handlers = captureHandlers()

      handlers['settings:set'](mockEvent, 'myKey', 'myValue')

      expect(setSetting).toHaveBeenCalledWith('myKey', 'myValue')
    })

    it('settings:getJson calls getSettingJson with key', () => {
      vi.mocked(getSettingJson).mockReturnValue({ foo: 'bar' })
      const handlers = captureHandlers()

      const result = handlers['settings:getJson'](mockEvent, 'myKey')

      expect(getSettingJson).toHaveBeenCalledWith('myKey')
      expect(result).toEqual({ foo: 'bar' })
    })

    it('settings:setJson calls setSettingJson with key and value', () => {
      const handlers = captureHandlers()

      handlers['settings:setJson'](mockEvent, 'myKey', { foo: 'bar' })

      expect(setSettingJson).toHaveBeenCalledWith('myKey', { foo: 'bar' })
    })

    it('settings:delete calls deleteSetting with key', () => {
      const handlers = captureHandlers()

      handlers['settings:delete'](mockEvent, 'myKey')

      expect(deleteSetting).toHaveBeenCalledWith('myKey')
    })

    it('settings:saveProfile calls saveProfile with name', () => {
      const handlers = captureHandlers()

      handlers['settings:saveProfile'](mockEvent, 'dev-mode')

      expect(saveProfile).toHaveBeenCalledWith('dev-mode')
    })

    it('settings:loadProfile calls loadProfile with name', () => {
      vi.mocked(loadProfile).mockReturnValue({ theme: 'dark' })
      const handlers = captureHandlers()

      const result = handlers['settings:loadProfile'](mockEvent, 'dev-mode')

      expect(loadProfile).toHaveBeenCalledWith('dev-mode')
      expect(result).toEqual({ theme: 'dark' })
    })

    it('settings:applyProfile calls applyProfile with name', () => {
      vi.mocked(applyProfile).mockReturnValue(true)
      const handlers = captureHandlers()

      const result = handlers['settings:applyProfile'](mockEvent, 'dev-mode')

      expect(applyProfile).toHaveBeenCalledWith('dev-mode')
      expect(result).toBe(true)
    })

    it('settings:listProfiles calls listProfiles', () => {
      vi.mocked(listProfiles).mockReturnValue(['dev-mode', 'prod-mode'])
      const handlers = captureHandlers()

      const result = handlers['settings:listProfiles'](mockEvent)

      expect(listProfiles).toHaveBeenCalled()
      expect(result).toEqual(['dev-mode', 'prod-mode'])
    })

    it('settings:deleteProfile calls deleteProfile with name', () => {
      const handlers = captureHandlers()

      handlers['settings:deleteProfile'](mockEvent, 'dev-mode')

      expect(deleteProfile).toHaveBeenCalledWith('dev-mode')
    })

    it('settings:getEncryptionStatus returns available true with undefined reason when encryption available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
      const handlers = captureHandlers()

      const result = handlers['settings:getEncryptionStatus'](mockEvent)

      expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled()
      expect(result).toEqual({ available: true, reason: undefined })
    })

    it('settings:getEncryptionStatus returns available false with reason when encryption unavailable', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
      const handlers = captureHandlers()

      const result = handlers['settings:getEncryptionStatus'](mockEvent)

      expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled()
      expect(result).toEqual({ available: false, reason: 'System keychain unavailable' })
    })

    describe('profile name validation', () => {
      const invalidNames = [
        '',
        'a'.repeat(51),
        '../etc',
        'name with spaces',
        'name!@#',
        'name\0null'
      ]
      const validNames = ['dev-mode', 'my_profile', 'Profile123', 'a', 'z-9_Z']

      describe('settings:saveProfile', () => {
        for (const name of invalidNames) {
          it(`rejects invalid name: "${name.slice(0, 20)}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:saveProfile'](mockEvent, name)).toThrow(
              /invalid profile name/i
            )
            expect(saveProfile).not.toHaveBeenCalled()
          })
        }

        for (const name of validNames) {
          it(`accepts valid name: "${name}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:saveProfile'](mockEvent, name)).not.toThrow()
          })
        }
      })

      describe('settings:loadProfile', () => {
        for (const name of invalidNames) {
          it(`rejects invalid name: "${name.slice(0, 20)}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:loadProfile'](mockEvent, name)).toThrow(
              /invalid profile name/i
            )
            expect(loadProfile).not.toHaveBeenCalled()
          })
        }

        for (const name of validNames) {
          it(`accepts valid name: "${name}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:loadProfile'](mockEvent, name)).not.toThrow()
          })
        }
      })

      describe('settings:applyProfile', () => {
        for (const name of invalidNames) {
          it(`rejects invalid name: "${name.slice(0, 20)}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:applyProfile'](mockEvent, name)).toThrow(
              /invalid profile name/i
            )
            expect(applyProfile).not.toHaveBeenCalled()
          })
        }

        for (const name of validNames) {
          it(`accepts valid name: "${name}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:applyProfile'](mockEvent, name)).not.toThrow()
          })
        }
      })

      describe('settings:deleteProfile', () => {
        for (const name of invalidNames) {
          it(`rejects invalid name: "${name.slice(0, 20)}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:deleteProfile'](mockEvent, name)).toThrow(
              /invalid profile name/i
            )
            expect(deleteProfile).not.toHaveBeenCalled()
          })
        }

        for (const name of validNames) {
          it(`accepts valid name: "${name}"`, () => {
            const handlers = captureHandlers()
            expect(() => handlers['settings:deleteProfile'](mockEvent, name)).not.toThrow()
          })
        }
      })
    })

    describe('settings:set — worktreeBase path validation', () => {
      it('allows agentManager.worktreeBase set to a path inside homedir', () => {
        const handlers = captureHandlers()
        const safePath = join(homedir(), 'worktrees', 'bde')

        expect(() =>
          handlers['settings:set'](mockEvent, 'agentManager.worktreeBase', safePath)
        ).not.toThrow()

        expect(setSetting).toHaveBeenCalledWith('agentManager.worktreeBase', safePath)
      })

      it('rejects agentManager.worktreeBase set to /etc/malicious', () => {
        const handlers = captureHandlers()

        expect(() =>
          handlers['settings:set'](mockEvent, 'agentManager.worktreeBase', '/etc/malicious')
        ).toThrow(/home directory/i)

        expect(setSetting).not.toHaveBeenCalled()
      })

      it('rejects agentManager.worktreeBase set to /tmp/bad (outside homedir)', () => {
        const handlers = captureHandlers()

        expect(() =>
          handlers['settings:set'](mockEvent, 'agentManager.worktreeBase', '/tmp/bad')
        ).toThrow(/home directory/i)

        expect(setSetting).not.toHaveBeenCalled()
      })

      it('does not validate other setting keys', () => {
        const handlers = captureHandlers()

        expect(() =>
          handlers['settings:set'](mockEvent, 'some.other.key', '/etc/whatever')
        ).not.toThrow()

        expect(setSetting).toHaveBeenCalledWith('some.other.key', '/etc/whatever')
      })
    })
  })
})
