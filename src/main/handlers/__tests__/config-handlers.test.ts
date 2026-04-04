/**
 * Config handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

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

import { registerConfigHandlers } from '../config-handlers'
import { safeHandle } from '../../ipc-utils'
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

  it('registers all 10 settings channels', () => {
    registerConfigHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(10)
    expect(safeHandle).toHaveBeenCalledWith('settings:get', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:set', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:getJson', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:setJson', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:delete', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:saveProfile', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:loadProfile', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:applyProfile', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:listProfiles', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:deleteProfile', expect.any(Function))
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
      vi.mocked(loadProfile).mockReturnValue({ 'theme': 'dark' })
      const handlers = captureHandlers()

      const result = handlers['settings:loadProfile'](mockEvent, 'dev-mode')

      expect(loadProfile).toHaveBeenCalledWith('dev-mode')
      expect(result).toEqual({ 'theme': 'dark' })
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
  })
})
